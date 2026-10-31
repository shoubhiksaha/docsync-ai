# Branch protection

Branch protection, environments and merge settings are applied by a script, so they stay in
sync with the workflows:

```bash
scripts/setup-repo-governance.sh --dry-run
scripts/setup-repo-governance.sh
```

It configures:

- **`main` and `staging`**: PR required (no approving review: GitHub never lets a solo owner approve
  their own PR, and the environment approval below gates every deploy), conversations resolved,
  no force-push or deletion.
- **Required checks** (from `.github/workflows/pr-check.yml`): `Branch Policy`, plus
  `Quality / Conflict Marker Check`, `Quality / Secret Scan`, `Quality / Lint & Type Check`,
  `Quality / Dependency Audit`, `Quality / Unit Tests & Coverage`, `Quality / Production Build`,
  `Quality / E2E Smoke`.
- **Up-to-date branches**: required on `main` only. On `staging` it is off on purpose: catching up
  with staging would mean merging staging into the feature, which would then be refused by main.
- **Merge method**: merge commits only. The provenance check needs each feature's commits to exist on staging.
- **Environments** `staging` (branch `staging`) and `production` (branch `main`), each with the owner
  as required reviewer.

If you rename a job in `.github/workflows/quality.yml`, update `QUALITY_CHECKS` in
`scripts/setup-repo-governance.sh` and re-run it, or PRs will wait forever for a check that no
longer exists.

See [RELEASE_FLOW.md](RELEASE_FLOW.md) for the full flow.
