#!/usr/bin/env bash
#
# Download and install the latest Rockion macOS (Apple Silicon) release.
# Re-run any time to update to the newest published release.
#
#   bash dev/macos/install-latest.sh
#
# GitHub points /releases/latest/ at the most recent published release, so no
# special tag is needed. Apple Silicon only — the release does not build for Intel.

set -euo pipefail

repo="rocketpowerinc/rockion"
asset="rockion-macos-arm64.zip"
zip="/tmp/$asset"
app="/Applications/Rockion.app"

echo ">> Downloading $asset (latest release)..."
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh release download --repo "$repo" --pattern "$asset" --dir /tmp --clobber
else
  curl -fSL -o "$zip" "https://github.com/$repo/releases/latest/download/$asset"
fi

echo ">> Installing into /Applications..."
unzip -oq "$zip" -d /Applications

# The app is unsigned/un-notarized; strip the Gatekeeper quarantine so it opens.
xattr -dr com.apple.quarantine "$app" || true
rm -f "$zip"

echo ">> Launching Rockion..."
open "$app"
