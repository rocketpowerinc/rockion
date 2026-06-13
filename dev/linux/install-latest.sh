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
# Download into /tmp (world-readable, mode 1777) so apt's unprivileged "_apt"
# sandbox user can read it — ~/Downloads is 0750 and would be denied.
deb="/tmp/$asset"

url="https://github.com/$repo/releases/latest/download/$asset"

echo ">> Downloading latest $asset..."
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  # Use gh when available (also handles private repos).
  gh release download --repo "$repo" --pattern "$asset" --dir /tmp --clobber
else
  curl -fSL -o "$deb" "$url"
fi
chmod 0644 "$deb"

echo ">> Installing (resolving dependencies)..."
sudo apt-get install -y "$deb"

rm -f "$deb"
echo ">> Done. Launch Rockion from your app menu, or run: rockion"
