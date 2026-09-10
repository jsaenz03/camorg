#!/usr/bin/env bash
# Runs every assert-based self-check plus the licence keygen selftest.
# Exits non-zero on the first failure. Used by CI and safe to run locally.
set -euo pipefail
cd "$(dirname "$0")/.."

# self-check-result-files pins the synced pdf.js worker asset. The sync
# normally runs via npm's predev/prebuild hooks, which a fresh checkout
# (and the CI checks job) hasn't executed yet.
node scripts/sync-pdfjs-assets.mjs >/dev/null

for s in scripts/self-check-*.mjs scripts/check-features.mjs; do
  echo "== $s"
  node "$s"
done

echo "== scripts/licence-keygen.mjs selftest"
node scripts/licence-keygen.mjs selftest

echo "All self-checks passed."
