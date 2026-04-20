#!/usr/bin/env python3
"""Merge a contributor's contributions.json into data/locations.json.

Usage:
  python3 scripts/merge_contributions.py path/to/contributions.json

Matches existing pins by google_maps_url; duplicates are skipped. A summary
is printed and the file is rewritten in place.
"""

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LOCATIONS = REPO / "data" / "locations.json"


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("contributions", help="path to contributions.json")
    ap.add_argument("--target", default=str(LOCATIONS),
                    help=f"locations.json to merge into (default: {LOCATIONS.relative_to(REPO)})")
    ap.add_argument("--contributor", default=None,
                    help="stamp added pins with this contributor name (GitHub login)")
    ap.add_argument("--dry-run", action="store_true", help="print the plan without writing")
    args = ap.parse_args(argv[1:])

    contribs_path = Path(args.contributions)
    if not contribs_path.is_absolute():
        contribs_path = Path.cwd() / contribs_path
    target_path = Path(args.target)
    if not target_path.is_absolute():
        target_path = REPO / target_path

    contribs = json.loads(contribs_path.read_text(encoding="utf-8"))
    if not isinstance(contribs, dict):
        print("error: contributions file must be a JSON object", file=sys.stderr)
        return 1
    target = json.loads(target_path.read_text(encoding="utf-8")) if target_path.exists() else {}

    added = 0
    skipped = 0
    by_video = []
    for bv, locs in contribs.items():
        if not isinstance(locs, list) or not locs:
            continue
        existing = target.setdefault(bv, [])
        existing_urls = {l.get("google_maps_url") for l in existing}
        new_for_video = 0
        for loc in locs:
            url = loc.get("google_maps_url")
            if url and url in existing_urls:
                skipped += 1
                continue
            if args.contributor:
                loc = {**loc, "contributor": args.contributor}
            existing.append(loc)
            existing_urls.add(url)
            added += 1
            new_for_video += 1
        if new_for_video:
            by_video.append((bv, new_for_video))

    print(f"contributor file: {contribs_path}")
    print(f"target:           {target_path.relative_to(REPO) if target_path.is_relative_to(REPO) else target_path}")
    print(f"added:            {added}")
    print(f"skipped (dup):    {skipped}")
    for bv, n in by_video:
        print(f"  + {bv}: {n}")

    if args.dry_run:
        print("dry run — not written")
        return 0

    tmp = target_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(target, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(target_path)
    print(f"wrote {target_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
