#!/usr/bin/env python3
"""
Extract files from `full_app_code.txt` into the local workspace.

Each file in the bundle is separated by a header block:
================================================================================
File: relative/path.ext
================================================================================
<file contents>

The script parses those sections and writes the contents to their respective
paths, creating parent directories as needed.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_BUNDLE = ROOT / "full_app_code.txt"
HEADER_PATTERN = re.compile(
    r"^={10,}\r?\nFile: (?P<path>.+?)\r?\n={10,}\r?\n",
    re.MULTILINE,
)


def main() -> None:
    if not SOURCE_BUNDLE.exists():
        raise SystemExit(f"Bundle not found: {SOURCE_BUNDLE}")

    data = SOURCE_BUNDLE.read_text(encoding="utf-8")
    matches = list(HEADER_PATTERN.finditer(data))

    if not matches:
        raise SystemExit("No file entries found in bundle.")

    print(f"Found {len(matches)} files in bundle.")

    for index, match in enumerate(matches):
        rel_path = match.group("path").strip()
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(data)
        payload = data[start:end]

        # Normalize trailing newlines so each file ends with at most one newline.
        payload = payload.rstrip("\r\n")
        text = payload + "\n" if payload else ""

        target = ROOT / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

        print(f"[OK] Wrote {rel_path} ({len(text)} bytes)")


if __name__ == "__main__":
    main()
