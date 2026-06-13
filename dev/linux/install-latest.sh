#!/usr/bin/env bash
#
# Download and install the latest Rockion AnduinOS package from GitHub Releases.
# Re-run any time to update to the newest published release.
#
#   bash dev/linux/install-latest.sh
#
# Works without auth for the public repo. GitHub automatically points
# /releases/latest/ at the most recent published (non-draft) release, so no
# special tag is needed.

set -euo pipefail

repo="rocketpowerinc/rockion"
asset="rockion-anduinos-amd64.deb"
checksums="SHA256SUMS.txt"
tmp_dir="$(mktemp -d /tmp/rockion-install.XXXXXX)"
chmod 0755 "$tmp_dir"
trap 'rm -rf "$tmp_dir"' EXIT
deb="$tmp_dir/$asset"
manifest="$tmp_dir/$checksums"
base_url="https://github.com/$repo/releases/latest/download"

echo ">> Downloading latest $asset..."
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh release download --repo "$repo" --pattern "$asset" --dir "$tmp_dir" --clobber
  gh release download --repo "$repo" --pattern "$checksums" --dir "$tmp_dir" --clobber
else
  curl -fSL -o "$deb" "$base_url/$asset"
  curl -fSL -o "$manifest" "$base_url/$checksums"
fi
chmod 0644 "$deb"

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
actual="$(sha256sum "$deb" | awk '{print tolower($1)}')"
if [[ ! "$expected" =~ ^[0-9a-f]{64}$ ]] || [[ "$actual" != "$expected" ]]; then
  echo "ERROR: $asset failed SHA-256 verification." >&2
  exit 1
fi
echo ">> SHA-256 verified."

echo ">> Installing (resolving dependencies)..."
sudo apt-get install -y "$deb"

echo ">> Done. Launch Rockion from your app menu, or run: rockion"
