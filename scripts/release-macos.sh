#!/usr/bin/env bash
# The per-release mac steps, automated (AGENTS.md, releases convention).
#
# CI attaches the signed + notarised universal DMG to a release; this script
# verifies it, drops it into the distribution page's static folder (both URL
# names — the landing page keeps per-arch buttons even though the DMG is
# universal) and deploys the worker so the live site serves it.
#
# Usage: scripts/release-macos.sh [tag] [--yes] [--dry-run]
#   tag        GitHub release tag; defaults to the latest stable release
#              (prereleases like the rolling edge never resolve as "latest").
#   --yes      deploy without asking (for non-interactive runs).
#   --dry-run  download + verify, then stop before touching the live site.
#
# Needs: gh (authed), xcrun, diskutil, wrangler (npx). Push ≠ publish: without
# step 3 the live distribution page keeps serving the previous DMG.

set -euo pipefail
cd "$(dirname "$0")/.."

TAG=""
ASSUME_YES=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) TAG="$arg" ;;
  esac
done

if [ -z "$TAG" ]; then
  TAG=$(gh release view --json tagName -q .tagName)
fi
echo "== Release: $TAG"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Step 1 — download + verify the CI-signed DMG.
gh release download "$TAG" -p '*_universal.dmg' -D "$TMP"
DMG=$(find "$TMP" -name '*_universal.dmg' | head -1)
if [ -z "$DMG" ]; then
  echo "ERROR: no *_universal.dmg on $TAG — releases before 0.15.3 carry" \
       "unsigned per-arch DMGs; run the local fallback instead" \
       "(AGENTS.md, releases convention)." >&2
  exit 1
fi
echo "== Verifying $DMG"
codesign -dv "$DMG" 2>&1 | grep TeamIdentifier
xcrun stapler validate "$DMG"

# Gatekeeper assesses the app inside the DMG, not the image itself.
MNT="$TMP/mnt"
diskutil image attach --mountOptions nobrowse --readOnly --mountPoint "$MNT" "$DMG" >/dev/null
spctl -a -vv "$MNT/Camog.app"
diskutil eject "$MNT" >/dev/null

SHA=$(shasum -a 256 "$DMG" | cut -d' ' -f1)
echo "== sha256: $SHA"

# Step 2 — into the distribution page's static folder (gitignored by design).
DEST="activation-server/public/download"
if [ "$DRY_RUN" = 1 ]; then
  echo "== dry-run: would copy over $DEST/Camog-macOS-AppleSilicon.dmg and" \
       "$DEST/Camog-macOS-Intel.dmg, then deploy — stopping here."
  exit 0
fi
cp "$DMG" "$DEST/Camog-macOS-AppleSilicon.dmg"
cp "$DMG" "$DEST/Camog-macOS-Intel.dmg"
echo "== Copied the DMG over both distribution-page names"

# Step 3 — publish (the only outward-facing action; ask unless --yes).
if [ "$ASSUME_YES" != 1 ]; then
  read -r -p "Deploy $TAG's DMG to the live distribution page? [y/N] " ANSWER
  [ "$ANSWER" = "y" ] || { echo "Aborted — nothing was deployed."; exit 1; }
fi
(cd activation-server && npx wrangler deploy --config wrangler.toml)

# Post-deploy proof: the live download must be byte-identical.
LIVE_SHA=$(curl -sL "https://camog-license.cliniciq.com.au/download/Camog-macOS-AppleSilicon.dmg" | shasum -a 256 | cut -d' ' -f1)
if [ "$SHA" = "$LIVE_SHA" ]; then
  echo "== Live download verified: sha256 matches ($SHA)"
else
  echo "ERROR: live download sha256 ($LIVE_SHA) != $SHA — check the deploy." >&2
  exit 1
fi
