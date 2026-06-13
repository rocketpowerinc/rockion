#!/usr/bin/env bash
#
# Build (and optionally package) Rockion natively on AnduinOS / Ubuntu 24.04.
# Mirrors the `build-anduinos` job in .github/workflows/release.yml.
#
# Usage:
#   dev/linux/build-local.sh           # build build/bin/rockion
#   dev/linux/build-local.sh --deb     # also produce build/bin/rockion-anduinos-amd64.deb
#   dev/linux/build-local.sh --run     # build, then launch it
#
# AnduinOS is Ubuntu 24.04-based, which ships WebKitGTK 4.1 (not 4.0). The
# `-tags webkit2_41` flag is mandatory or the build links the missing 4.0 ABI.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

make_deb=false
run_after=false
for arg in "$@"; do
  case "$arg" in
    --deb) make_deb=true ;;
    --run) run_after=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# --- sanity checks ---------------------------------------------------------
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This script builds the Linux binary and must run on Linux (AnduinOS/Ubuntu 24.04)." >&2
  exit 1
fi

missing=()
for cmd in go node npm wails; do
  command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
done
if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  missing+=("libwebkit2gtk-4.1-dev")
fi
if ! pkg-config --exists gtk+-3.0 2>/dev/null; then
  missing+=("libgtk-3-dev")
fi

if (( ${#missing[@]} > 0 )); then
  cat >&2 <<EOF
Missing build prerequisites: ${missing[*]}

Install the system libraries (and dpkg-dev for --deb):
  sudo apt-get update
  sudo apt-get install -y build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev dpkg-dev

Go 1.26+ is required (apt's package is usually too old) — install from https://go.dev/dl
or 'sudo snap install go --classic'. Then:
  go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
  export PATH="\$PATH:\$(go env GOPATH)/bin"
EOF
  exit 1
fi

# --- build -----------------------------------------------------------------
echo ">> Building Rockion for linux/amd64 (webkit2gtk 4.1)..."
wails build -platform linux/amd64 -clean -trimpath -tags webkit2_41 -o rockion

binary="$repo_root/build/bin/rockion"
echo ">> Built: $binary"

# Fail loudly if we somehow linked the wrong WebKitGTK ABI.
if readelf -d "$binary" | grep -Fq 'libwebkit2gtk-4.0.so.37'; then
  echo "ERROR: binary links WebKitGTK 4.0, which AnduinOS does not provide." >&2
  echo "       Ensure you built with -tags webkit2_41." >&2
  exit 1
fi

if $make_deb; then
  echo ">> Packaging .deb..."
  BINARY="$binary" \
    OUTPUT="$repo_root/build/bin/rockion-anduinos-amd64.deb" \
    bash "$repo_root/dev/linux/package-anduinos-deb.sh"
fi

if $run_after; then
  echo ">> Launching Rockion..."
  exec "$binary"
fi

echo ">> Done. Run it with: ./build/bin/rockion"
$make_deb && echo ">> Install the package with: sudo apt install ./build/bin/rockion-anduinos-amd64.deb"
exit 0
