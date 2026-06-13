#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
binary="${BINARY:-$repo_root/build/bin/rockion}"
output="${OUTPUT:-$repo_root/build/bin/rockion-anduinos-amd64.deb}"
package_root="${PACKAGE_ROOT:-$repo_root/build/anduinos-amd64}"
version="$(
  node -e "const w=require(process.argv[1]); process.stdout.write(w.info.productVersion)" \
    "$repo_root/wails.json"
)"

if [[ ! -x "$binary" ]]; then
  echo "Rockion binary is missing or not executable: $binary" >&2
  exit 1
fi
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+~.-][0-9A-Za-z.+~-]+)?$ ]]; then
  echo "Invalid package version: $version" >&2
  exit 1
fi

rm -rf "$package_root"
rm -f "$output"
mkdir -p \
  "$package_root/DEBIAN" \
  "$package_root/usr/bin" \
  "$package_root/usr/share/applications" \
  "$package_root/usr/share/icons/hicolor/1024x1024/apps" \
  "$(dirname "$output")"

install -m 0755 "$binary" "$package_root/usr/bin/rockion"
install -m 0644 \
  "$repo_root/dev/linux/rockion.desktop" \
  "$package_root/usr/share/applications/rockion.desktop"
install -m 0644 \
  "$repo_root/build/appicon.png" \
  "$package_root/usr/share/icons/hicolor/1024x1024/apps/rockion.png"

installed_size="$(du -sk "$package_root/usr" | awk '{print $1}')"
cat > "$package_root/DEBIAN/control" <<EOF
Package: rockion
Version: $version
Section: editors
Priority: optional
Architecture: amd64
Depends: libgtk-3-0t64, libwebkit2gtk-4.1-0, xdg-utils
Installed-Size: $installed_size
Maintainer: Rockion <support@rocketpowerinc.com>
Homepage: https://github.com/rocketpowerinc/rockion
Description: Local-first Markdown editor
 Rockion combines a Notion-inspired interface with Markdown files stored
 directly in a user-selected vault.
EOF

chmod 0755 "$package_root/DEBIAN"
chmod 0644 "$package_root/DEBIAN/control"
dpkg-deb --root-owner-group --build "$package_root" "$output"

echo "Created $output"
