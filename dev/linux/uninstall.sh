#!/usr/bin/env bash
#
# Remove the Rockion AnduinOS/Ubuntu package (binary, desktop entry, icons).
#
#   bash dev/linux/uninstall.sh
#
# Uses purge so the package's maintainer scripts also refresh the icon/desktop
# caches on the way out.

set -euo pipefail

if dpkg-query -W -f='${Status}' rockion 2>/dev/null | grep -q 'install ok installed'; then
  sudo apt-get purge -y rockion
  echo ">> Rockion removed."
else
  echo ">> Rockion is not installed."
fi
