#!/usr/bin/env python3
"""
Report which files listed in `full_app_code.txt` are missing actual content sections.

The bundle begins with an index of `N. path` entries. Later each file should have a
header block:

================================================================================
File: path
================================================================================
<contents>

This script parses both the index and the headers and prints a summary so we can
spot gaps in the export.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
SOURCE_BUNDLE = ROOT / "full_app_code.txt"

INDEX_PATTERN = re.compile(r"^\s*\d+\.\s+(?P<path>.+?)\s*$", re.MULTILINE)
HEADER_PATTERN = re.compile(
    r"^={10,}\r?\nFile: (?P<path>.+?)\r?\n={10,}\r?\n",
    re.MULTILINE,
)


def parse_index(text: str) -> list[str]:
    return [match.group("path").strip() for match in INDEX_PATTERN.finditer(text)]


def parse_headers(text: str) -> list[str]:
    return [match.group("path").strip() for match in HEADER_PATTERN.finditer(text)]


def main() -> None:
    if not SOURCE_BUNDLE.exists():
        raise SystemExit(f"Bundle not found: {SOURCE_BUNDLE}")

    data = SOURCE_BUNDLE.read_text(encoding="utf-8")

    # Limit index parsing to the section between "INDEX:" and the first file header.
    try:
        index_start = data.index("INDEX:")
        first_header = HEADER_PATTERN.search(data)
        if not first_header:
            raise ValueError("No file headers found in bundle.")
        index_text = data[index_start:first_header.start()]
    except ValueError:
        raise SystemExit("Unable to isolate index section in bundle.")

    index_entries = parse_index(index_text)
    header_entries = parse_headers(data)

    missing = sorted(set(index_entries) - set(header_entries))

    print(f"Index entries: {len(index_entries)}")
    print(f"Headers found: {len(header_entries)}")
    if not missing:
        print("All indexed files have headers. Nothing appears to be missing.")
        return

    print(f"Missing headers for {len(missing)} paths:")
    for path in missing:
        print(f" - {path}")


if __name__ == "__main__":
    main()
