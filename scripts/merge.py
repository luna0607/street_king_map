#!/usr/bin/env python3
"""Merge the four bilibili_metadata_N.json files into one.

- Normalizes post_date to YYYY-MM-DD (adds current year when only MM-DD).
- Detects duplicate BV ids.
- Reports the merged entry count and the date range.
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
INPUTS = [DATA / f"bilibili_metadata_{i}.json" for i in (1, 2, 3, 4)]
OUTPUT = DATA / "videos.json"
CURRENT_YEAR = 2026  # MM-DD rows render without year when posted in the current year.

BV_RE = re.compile(r"/video/(BV[0-9A-Za-z]+)")


def normalize_date(raw: str) -> str:
    raw = raw.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return raw
    if re.fullmatch(r"\d{2}-\d{2}", raw):
        return f"{CURRENT_YEAR}-{raw}"
    return raw  # leave anything unexpected untouched


def bv_id(link: str) -> str:
    m = BV_RE.search(link)
    return m.group(1) if m else ""


def main() -> int:
    merged: list[dict] = []
    per_file: list[tuple[str, int]] = []
    for path in INPUTS:
        entries = json.loads(path.read_text(encoding="utf-8"))
        for e in entries:
            e["post_date"] = normalize_date(e.get("post_date", ""))
            e["bv"] = bv_id(e.get("link", ""))
            e["_source_file"] = path.name
        per_file.append((path.name, len(entries)))
        merged.extend(entries)

    # Duplicate check by BV id.
    seen: dict[str, list[int]] = {}
    for i, e in enumerate(merged):
        seen.setdefault(e["bv"], []).append(i)
    duplicates = {bv: idxs for bv, idxs in seen.items() if len(idxs) > 1}

    # Date format check.
    bad_dates = [(i, e["post_date"]) for i, e in enumerate(merged)
                 if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", e["post_date"])]

    # Sort by post_date descending for the final output, mirroring upload order.
    merged_sorted = sorted(merged, key=lambda e: e["post_date"], reverse=True)

    # Strip helper keys from the on-disk output.
    clean = [{k: v for k, v in e.items() if not k.startswith("_")} for e in merged_sorted]
    OUTPUT.write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")

    # Report.
    print("=== per-file counts ===")
    for name, n in per_file:
        print(f"  {name}: {n}")
    total = sum(n for _, n in per_file)
    unique = len(seen)
    print(f"total entries (raw):    {total}")
    print(f"unique BV ids:          {unique}")
    print(f"duplicates:             {len(duplicates)}")
    for bv, idxs in duplicates.items():
        names = [merged[i]["name"] for i in idxs]
        files = [merged[i]["_source_file"] for i in idxs]
        print(f"  {bv} in {files}: {names[0]!r}")

    dates = [e["post_date"] for e in merged if re.fullmatch(r"\d{4}-\d{2}-\d{2}", e["post_date"])]
    if dates:
        print(f"date range:             {min(dates)}  ->  {max(dates)}")
    print(f"rows with non-standard date: {len(bad_dates)}")
    for i, d in bad_dates:
        print(f"  row {i}: {d!r}")

    print(f"\nmerged file: {OUTPUT.name} ({len(clean)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
