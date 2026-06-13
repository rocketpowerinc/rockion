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
webkit_hook="$appdir/apprun-hooks/rockion-webkit.sh"

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

find_single_file() {
  local name="$1"
  local -a matches=()
  mapfile -t matches < <(find /usr -type f -name "$name" -print)
  if [[ "${#matches[@]}" -ne 1 ]]; then
    echo "Expected exactly one $name file; found ${#matches[@]}." >&2
    printf '  %s\n' "${matches[@]}" >&2
    exit 1
  fi
  printf '%s\n' "${matches[0]}"
}

find_library() {
  local name="$1"
  local path
  path="$(ldconfig -p | awk -v library="$name" '$1 == library { print $NF; exit }')"
  if [[ -z "$path" || ! -f "$path" ]]; then
    echo "Required runtime library was not found: $name" >&2
    exit 1
  fi
  printf '%s\n' "$path"
}

webkit_web_process="$(find_single_file WebKitWebProcess)"
webkit_network_process="$(find_single_file WebKitNetworkProcess)"
webkit_injected_bundle="$(find_single_file libwebkit2gtkinjectedbundle.so)"
webkit_exec_dir="$(dirname "$webkit_network_process")"
if [[ "$(dirname "$webkit_web_process")" != "$webkit_exec_dir" ]]; then
  echo 'WebKitGTK helper executables were found in different directories.' >&2
  exit 1
fi

# linuxdeploy's baseline excludes common font libraries. Force these into the
# AppImage so minimal supported distributions do not supply them implicitly.
forced_library_names=(
  libexpat.so.1
  libfontconfig.so.1
  libfreetype.so.6
  libfribidi.so.0
  libharfbuzz.so.0
)
forced_library_args=()
for library_name in "${forced_library_names[@]}"; do
  forced_library_args+=(--library "$(find_library "$library_name")")
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
    --executable "$webkit_web_process" \
    --executable "$webkit_network_process" \
    --library "$webkit_injected_bundle" \
    "${forced_library_args[@]}" \
    --plugin gtk

mapfile -t webkit_libraries < <(
  find "$appdir/usr/lib" -type f -name 'libwebkit2gtk-4.0.so.37*' -print
)
if [[ "${#webkit_libraries[@]}" -eq 0 ]]; then
  echo 'Bundled WebKitGTK library was not found in the AppDir.' >&2
  exit 1
fi
for library in "${webkit_libraries[@]}"; do
  python3 "$repo_root/dev/linux/patch-webkit-helper-path.py" \
    "$library" "$webkit_exec_dir" "usr/bin"
done

mkdir -p "$(dirname "$webkit_hook")"
cat > "$webkit_hook" <<'HOOK'
#!/usr/bin/env bash
export WEBKIT_INJECTED_BUNDLE_PATH="$APPDIR/usr/lib/libwebkit2gtkinjectedbundle.so"
HOOK
chmod 0755 "$webkit_hook"

for required_file in \
  "$appdir/usr/bin/WebKitWebProcess" \
  "$appdir/usr/bin/WebKitNetworkProcess" \
  "$appdir/usr/lib/libwebkit2gtkinjectedbundle.so" \
  "$appdir/usr/lib/libfontconfig.so.1" \
  "$appdir/usr/lib/libfreetype.so.6" \
  "$appdir/usr/lib/libfribidi.so.0" \
  "$appdir/usr/lib/libharfbuzz.so.0"; do
  if [[ ! -e "$required_file" ]]; then
    echo "Required AppImage runtime file was not bundled: $required_file" >&2
    exit 1
  fi
done

PATH="$tools_dir:$PATH" \
OUTPUT="$output_name" \
LDAI_OUTPUT="$output_name" \
LDAI_NO_APPSTREAM=1 \
  "$linuxdeploy" --appimage-extract-and-run \
    --appdir "$appdir" \
    --output appimage
popd >/dev/null

generated="$work_root/$output_name"
if [[ ! -f "$generated" ]]; then
  echo "linuxdeploy did not create the expected AppImage: $generated" >&2
  exit 1
fi

validation_root="$work_root/validation"
rm -rf "$validation_root"
mkdir -p "$validation_root"
(
  cd "$validation_root"
  "$generated" --appimage-extract >/dev/null
)
mapfile -t packaged_webkit_libraries < <(
  find "$validation_root/squashfs-root/usr/lib" \
    -type f -name 'libwebkit2gtk-4.0.so.37*' -print
)
if [[ "${#packaged_webkit_libraries[@]}" -eq 0 ]]; then
  echo 'Bundled WebKitGTK library was not found in the completed AppImage.' >&2
  exit 1
fi
for library in "${packaged_webkit_libraries[@]}"; do
  python3 "$repo_root/dev/linux/patch-webkit-helper-path.py" \
    --verify "$library" "$webkit_exec_dir" "usr/bin"
done

mv "$generated" "$output"
chmod 0755 "$output"

echo "Created $output"
