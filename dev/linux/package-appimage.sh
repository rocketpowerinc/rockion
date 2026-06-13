#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
arch="${ARCH:?ARCH must be amd64 or arm64}"
binary="${BINARY:-$repo_root/build/bin/rockion-linux-$arch}"
output="${OUTPUT:?OUTPUT must name the AppImage to create}"
work_root="${WORK_ROOT:-$repo_root/build/appimage-$arch}"
tools_dir="$work_root/tools"
appdir="$work_root/Rockion.AppDir"

case "$arch" in
  amd64)
    appimage_arch="x86_64"
    linuxdeploy_sha="514d4ffe2a2f757369b41863a4f63fbbb222c429652803ebc081cb16ba21ac25"
    apprun_sha="f30140a43a0a59e46db21bdefdf749b9e9f2c6946e92afabbacf98b8ae73fb4f"
    ;;
  arm64)
    appimage_arch="aarch64"
    linuxdeploy_sha="6d2f140cc8c3b07831b1011922ed453b34f7e90d21a4bfbc65e1ec99ca71b8f3"
    apprun_sha="072f17c0895a85c490282fe5395c5007e5fc75da727e553b3b8fb680feb11578"
    ;;
  *)
    echo "Unsupported AppImage architecture: $arch" >&2
    exit 1
    ;;
esac

gtk_plugin_commit="3b67a1d1c1b0c8268f57f2bce40fe2d33d409cea"
gtk_plugin_sha="b0f4cbc684a0103a9651f0955b635eaea0096b3a66c0f5a2c2aa337960375171"
linuxdeploy="$tools_dir/linuxdeploy-$appimage_arch.AppImage"
gtk_plugin="$tools_dir/linuxdeploy-plugin-gtk.sh"
apprun="$appdir/AppRun"

download_verified() {
  local url="$1"
  local target="$2"
  local expected_sha="$3"

  curl --fail --location --proto '=https' --tlsv1.2 "$url" --output "$target"
  printf '%s  %s\n' "$expected_sha" "$target" | sha256sum --check
}

if [[ ! -x "$binary" ]]; then
  echo "Rockion binary is missing or not executable: $binary" >&2
  exit 1
fi

rm -rf "$work_root"
rm -f "$output"
mkdir -p "$tools_dir" "$appdir/usr/bin" "$(dirname "$output")"

install -m 0755 "$binary" "$appdir/usr/bin/rockion"
install -m 0644 "$repo_root/build/appicon.png" "$appdir/.DirIcon"
install -m 0644 "$repo_root/dev/linux/rockion.desktop" "$appdir/rockion.desktop"
ln -s .DirIcon "$appdir/rockion.png"

download_verified \
  "https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-$appimage_arch.AppImage" \
  "$linuxdeploy" \
  "$linuxdeploy_sha"
download_verified \
  "https://github.com/AppImage/AppImageKit/releases/download/continuous/AppRun-$appimage_arch" \
  "$apprun" \
  "$apprun_sha"
download_verified \
  "https://raw.githubusercontent.com/linuxdeploy/linuxdeploy-plugin-gtk/$gtk_plugin_commit/linuxdeploy-plugin-gtk.sh" \
  "$gtk_plugin" \
  "$gtk_plugin_sha"
chmod 0755 "$linuxdeploy" "$apprun" "$gtk_plugin"

required_webkit_files=(
  WebKitWebProcess
  WebKitNetworkProcess
  libwebkit2gtkinjectedbundle.so
)
for required_file in "${required_webkit_files[@]}"; do
  mapfile -t matches < <(find /usr -type f -name "$required_file" -print)
  if [[ "${#matches[@]}" -eq 0 ]]; then
    echo "Required WebKitGTK runtime file was not found: $required_file" >&2
    exit 1
  fi
  for source in "${matches[@]}"; do
    target_dir="$appdir$(dirname "$source")"
    mkdir -p "$target_dir"
    install -m 0755 "$source" "$target_dir/$required_file"
  done
done

output="$(cd "$(dirname "$output")" && pwd)/$(basename "$output")"
output_name="$(basename "$output")"
pushd "$work_root" >/dev/null
PATH="$tools_dir:$PATH" \
LINUXDEPLOY="$linuxdeploy" \
DEPLOY_GTK_VERSION=3 \
NO_STRIP=1 \
OUTPUT="$output_name" \
LDAI_OUTPUT="$output_name" \
LDAI_NO_APPSTREAM=1 \
  "$linuxdeploy" --appimage-extract-and-run \
    --appdir "$appdir" \
    --plugin gtk \
    --output appimage
popd >/dev/null

generated="$work_root/$output_name"
if [[ ! -f "$generated" ]]; then
  echo "linuxdeploy did not create the expected AppImage: $generated" >&2
  exit 1
fi
mv "$generated" "$output"
chmod 0755 "$output"

echo "Created $output"
