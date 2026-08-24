#!/usr/bin/env bash
# Runs every assert-based self-check plus the licence keygen selftest.
# Exits non-zero on the first failure. Used by CI and safe to run locally.
set -euo pipefail
cd "$(dirname "$0")/.."

for s in scripts/self-check-*.mjs scripts/check-features.mjs; do
  echo "== $s"
  node "$s"
done

echo "== scripts/licence-keygen.mjs selftest"
node scripts/licence-keygen.mjs selftest

echo "All self-checks passed."
