#!/usr/bin/env bash
#
# Remove Rockion from /Applications, plus its cached WebView/app data.
#
#   bash dev/macos/uninstall.sh
#
# Prefix with sudo if /Applications isn't writable by your user.

set -euo pipefail

app="/Applications/Rockion.app"
if [ -d "$app" ]; then
  rm -rf "$app"
  echo ">> Removed $app"
else
  echo ">> $app not found."
fi

# Optional: clear cached WebKit/app data (bundle id is com.wails.rockion).
rm -rf "$HOME/Library/WebKit/com.wails.rockion" \
       "$HOME/Library/Caches/com.wails.rockion" \
       "$HOME/Library/Preferences/com.wails.rockion.plist" \
       "$HOME/Library/Saved Application State/com.wails.rockion.savedState" 2>/dev/null || true

echo ">> Rockion removed."
