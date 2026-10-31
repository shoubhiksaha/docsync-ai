#!/usr/bin/env bash
# ==============================================================================
# DocSync AI — one-time Google Cloud setup for Cloud Run hosting. Safe to re-run.
#
# Usage: bash scripts/gcp/setup.sh            (needs gcloud signed in as a project owner, and gh)
#
# Creates, in project docsyncai1 (Mumbai, asia-south1):
#   • APIs: Cloud Run, Artifact Registry, Secret Manager, and IAM / IAM Credentials / STS
#     (the last three let GitHub Actions sign in without a stored key)
#   • Artifact Registry repository "docsync" that keeps the 4 newest images (about 108 MB each
#     compressed, sharing layers)
#   • Runtime service accounts docsync-staging and docsync-production (no project roles)
#   • Deployer service account docsync-deployer, usable only by this repository's
#     staging and production GitHub environments (Workload Identity Federation)
#   • GitHub repository variables GCP_WORKLOAD_IDENTITY_PROVIDER and GCP_SERVICE_ACCOUNT
# ==============================================================================
set -euo pipefail

PROJECT="${GCP_PROJECT_ID:-docsyncai1}"
REGION="asia-south1"
REPO="${REPO:-shoubhiksaha/docsync-ai}"
DEPLOYER="docsync-deployer@${PROJECT}.iam.gserviceaccount.com"
POOL="github"
PROVIDER="github"

# Newly enabled APIs and new service accounts take a few seconds to be usable everywhere, so
# calls that depend on them are retried.
retry() {
    local attempt
    for attempt in 1 2 3 4 5 6; do
        "$@" && return 0
        echo "  …not ready yet, retrying in 10s (${attempt}/6)" >&2
        sleep 10
    done
    "$@"
}

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
REPO_ID="$(gh api "repos/${REPO}" -q .id)"

echo "[1/6] Enabling APIs"
gcloud services enable --project="$PROJECT" \
    run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
    iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

echo "[2/6] Artifact Registry repository"
if ! gcloud artifacts repositories describe docsync --project="$PROJECT" --location="$REGION" >/dev/null 2>&1; then
    retry gcloud artifacts repositories create docsync --project="$PROJECT" --location="$REGION" \
        --repository-format=docker --description="DocSync AI container images"
fi
POLICY="$(mktemp)"
trap 'rm -f "$POLICY"' EXIT
cat >"$POLICY" <<'JSON'
[
  {"name": "keep-newest-4", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 4}},
  {"name": "delete-older", "action": {"type": "Delete"}, "condition": {"tagState": "any"}}
]
JSON
retry gcloud artifacts repositories set-cleanup-policies docsync --project="$PROJECT" --location="$REGION" \
    --policy="$POLICY" --no-dry-run --quiet >/dev/null

echo "[3/6] Service accounts"
ensure_sa() {
    gcloud iam service-accounts describe "$1@${PROJECT}.iam.gserviceaccount.com" --project="$PROJECT" >/dev/null 2>&1 \
        || retry gcloud iam service-accounts create "$1" --project="$PROJECT" --display-name="$2"
}
ensure_sa docsync-staging "DocSync AI staging (runtime)"
ensure_sa docsync-production "DocSync AI production (runtime)"
ensure_sa docsync-deployer "DocSync AI deployer (GitHub Actions)"

echo "[4/6] Deployer permissions"
for role in roles/run.admin roles/secretmanager.viewer; do
    retry gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${DEPLOYER}" \
        --role="$role" --condition=None --quiet >/dev/null
done
retry gcloud artifacts repositories add-iam-policy-binding docsync --project="$PROJECT" --location="$REGION" \
    --member="serviceAccount:${DEPLOYER}" --role=roles/artifactregistry.writer --quiet >/dev/null
for env in staging production; do
    retry gcloud iam service-accounts add-iam-policy-binding "docsync-${env}@${PROJECT}.iam.gserviceaccount.com" \
        --project="$PROJECT" --member="serviceAccount:${DEPLOYER}" --role=roles/iam.serviceAccountUser --quiet >/dev/null
done

echo "[5/6] Workload Identity Federation for GitHub Actions"
if ! gcloud iam workload-identity-pools describe "$POOL" --project="$PROJECT" --location=global >/dev/null 2>&1; then
    gcloud iam workload-identity-pools create "$POOL" --project="$PROJECT" --location=global \
        --display-name="GitHub Actions"
fi
# Only deploy jobs of this repository (by id, so a rename or a look-alike repo can't use it)
# running in its approval-gated staging or production environment.
CONDITION="assertion.repository_id == '${REPO_ID}' && assertion.environment in ['staging', 'production']"
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" --project="$PROJECT" --location=global \
        --workload-identity-pool="$POOL" >/dev/null 2>&1; then
    gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --project="$PROJECT" --location=global \
        --workload-identity-pool="$POOL" --display-name="GitHub" \
        --issuer-uri="https://token.actions.githubusercontent.com" \
        --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.environment=assertion.environment" \
        --attribute-condition="$CONDITION"
fi
POOL_ID="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}"
retry gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" --project="$PROJECT" \
    --role=roles/iam.workloadIdentityUser \
    --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository_id/${REPO_ID}" --quiet >/dev/null

echo "[6/6] GitHub repository variables"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$REPO" --body "${POOL_ID}/providers/${PROVIDER}"
gh variable set GCP_SERVICE_ACCOUNT --repo "$REPO" --body "$DEPLOYER"

cat <<EOF

✅ Google Cloud is ready. Next:
  1. Upload each environment's settings (values never leave your machine except to Secret Manager):
        bash scripts/gcp/push-env.sh staging    .env.staging.local
        bash scripts/gcp/push-env.sh production .env.prod.local
  2. Optional staging domain: gh variable set STAGING_DOMAIN --env staging --body docsync-staging.analogdigital.tech
  3. Approve the waiting deploy in GitHub Actions, then point the domains at Cloud Run with the
     Cloudflare Worker (deploy/cloudflare-proxy/README.md).
EOF
