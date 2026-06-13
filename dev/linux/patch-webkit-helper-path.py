#!/usr/bin/env python3

import argparse
import os
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Replace WebKitGTK's absolute helper directory with an AppImage-relative path."
    )
    parser.add_argument("library", type=Path)
    parser.add_argument("old_path")
    parser.add_argument("new_path")
    parser.add_argument(
        "--verify",
        action="store_true",
        help="verify that the old path is absent and the replacement is present",
    )
    args = parser.parse_args()

    old = args.old_path.encode("utf-8") + b"\0"
    new = args.new_path.encode("utf-8") + b"\0"
    if len(new) > len(old):
        parser.error("the replacement path must not be longer than the compiled path")

    data = args.library.read_bytes()
    occurrences = data.count(old)
    if args.verify:
        if occurrences != 0:
            parser.error(f"compiled helper path is still present in {args.library}")
        if new not in data:
            parser.error(f"replacement helper path was not found in {args.library}")
        print(f"Verified AppImage-relative WebKit helper path in {args.library}")
        return 0

    if occurrences == 0:
        parser.error(f"compiled helper path was not found in {args.library}")

    replacement = new + (b"\0" * (len(old) - len(new)))
    patched = data.replace(old, replacement)
    temporary = args.library.with_name(f"{args.library.name}.patched")
    temporary.write_bytes(patched)
    os.chmod(temporary, args.library.stat().st_mode)
    temporary.replace(args.library)

    print(
        f"Patched {occurrences} WebKit helper path occurrence(s) in {args.library}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
