#!/usr/bin/env bash
# ==============================================================================
# DocSync AI — secret scan of tracked files (CI "Secret Scan" job and pre-push hook).
#
# Scans only what git tracks (untracked scratch files are ignored), so it checks what
# would actually be published. Hits are printed as file:line with the value redacted.
#
# Allowlist (keep it tight):
#   - .env.example, package-lock.json, docs/**, this script
#   - __tests__/** lines whose value is an obvious fake (fake/dummy/mock/test/example…)
# ==============================================================================
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: this script must run inside a git repository."
  exit 2
fi

# Prefixes are anchored to a non-key character so words like "task-…" don't match "sk-…".
PATTERNS=(
  'AIza[0-9A-Za-z_-]{30,}'                                  # Google API key
  'AQ\.[A-Za-z0-9_-]{30,}'                                  # Google API key (newer format)
  '(^|[^A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{10,}'             # Anthropic
  '(^|[^A-Za-z0-9_-])sk-(proj-)?[A-Za-z0-9_-]{20,}'         # OpenAI
  '(^|[^A-Za-z0-9_-])gsk_[A-Za-z0-9]{20,}'                  # Groq
  '(^|[^A-Za-z0-9_-])gh[pousr]_[A-Za-z0-9]{30,}'            # GitHub token
  '-----BEGIN (RSA |EC )?PRIVATE KEY-----'                  # PEM private key
  '"private_key":'                                          # Service-account JSON
)

GREP_ARGS=()
for p in "${PATTERNS[@]}"; do
  GREP_ARGS+=(-e "$p")
done

echo "Scanning tracked files for secrets..."

HITS="$(
  git grep -nIE "${GREP_ARGS[@]}" -- \
    . \
    ':(exclude).env.example' \
    ':(exclude)**/package-lock.json' \
    ':(exclude)package-lock.json' \
    ':(exclude)docs/**' \
    ':(exclude)scripts/check-secrets.sh' \
    || true
)"

FAKE_MARKERS='fake|dummy|mock|test|example|placeholder|sample|super-secret|your[_-]|xxxx|0000|1234|abcd'
FOUND=0

while IFS= read -r hit; do
  [ -z "$hit" ] && continue
  file="${hit%%:*}"
  rest="${hit#*:}"
  line="${rest%%:*}"
  content="${rest#*:}"

  if [[ "$file" == __tests__/* ]] && grep -qiE "$FAKE_MARKERS" <<<"$content"; then
    continue
  fi

  token="$(grep -oE "${GREP_ARGS[@]}" <<<"$content" | head -1 | sed -E 's/^[^A-Za-z0-9"-]//')"
  echo "  ${file}:${line}  ${token:0:8}…(redacted)"
  FOUND=$((FOUND + 1))
done <<<"$HITS"

if [ "$FOUND" -gt 0 ]; then
  echo
  echo "::error title=Secret scan::Found ${FOUND} possible secret(s) in tracked files."
  echo "Remove them, rotate the exposed keys, and load secrets from environment variables instead."
  exit 1
fi

echo "No secrets found in tracked files."
