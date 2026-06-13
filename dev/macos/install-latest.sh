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
checksums="SHA256SUMS.txt"
tmp_dir="$(mktemp -d /tmp/rockion-install.XXXXXX)"
trap 'rm -rf "$tmp_dir"' EXIT
zip="$tmp_dir/$asset"
manifest="$tmp_dir/$checksums"
app="/Applications/Rockion.app"
base_url="https://github.com/$repo/releases/latest/download"

echo ">> Downloading $asset (latest release)..."
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh release download --repo "$repo" --pattern "$asset" --dir "$tmp_dir" --clobber
  gh release download --repo "$repo" --pattern "$checksums" --dir "$tmp_dir" --clobber
else
  curl -fSL -o "$zip" "$base_url/$asset"
  curl -fSL -o "$manifest" "$base_url/$checksums"
fi

expected="$(
  awk -v name="$asset" '
    NF == 2 {
      file = $2
      sub(/^\*/, "", file)
      if (file == name) {
        print tolower($1)
        exit
      }
    }
  ' "$manifest"
)"
actual="$(shasum -a 256 "$zip" | awk '{print tolower($1)}')"
if [[ ! "$expected" =~ ^[0-9a-f]{64}$ ]] || [[ "$actual" != "$expected" ]]; then
  echo "ERROR: $asset failed SHA-256 verification." >&2
  exit 1
fi
echo ">> SHA-256 verified."

echo ">> Installing into /Applications..."
unzip -oq "$zip" -d /Applications

# Unsigned development releases may carry quarantine; signed/notarized releases
# are unaffected by removing this extended attribute.
xattr -dr com.apple.quarantine "$app" || true

echo ">> Launching Rockion..."
open "$app"
