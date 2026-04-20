#!/usr/bin/env python3
"""Merge a contributor's contributions.json into data/locations.json.

Supports both the structured format (add/update/remove) and the legacy flat
additions-only format. Duplicate adds (matched by google_maps_url) are skipped.

Usage:
  python3 scripts/merge_contributions.py path/to/contributions.json
  python3 scripts/merge_contributions.py path/to/contributions.json --contributor <login>
"""

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LOCATIONS = REPO / "data" / "locations.json"

ALLOWED_KEYS = ("place_name", "google_maps_url", "comment", "lat", "lng")


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("contributions", help="path to contributions.json")
    ap.add_argument("--target", default=str(LOCATIONS),
                    help=f"locations.json to merge into (default: {LOCATIONS.relative_to(REPO)})")
    ap.add_argument("--contributor", default=None,
                    help="stamp added/updated pins with this contributor name")
    ap.add_argument("--dry-run", action="store_true", help="print the plan without writing")
    args = ap.parse_args(argv[1:])

    contribs_path = Path(args.contributions)
    if not contribs_path.is_absolute():
        contribs_path = Path.cwd() / contribs_path
    target_path = Path(args.target)
    if not target_path.is_absolute():
        target_path = REPO / target_path

    contribs = json.loads(contribs_path.read_text(encoding="utf-8"))
    target = json.loads(target_path.read_text(encoding="utf-8")) if target_path.exists() else {}

    if not isinstance(contribs, dict):
        print("error: contributions file must be a JSON object", file=sys.stderr)
        return 1

    if any(k in contribs for k in ("add", "update", "remove")):
        add_data = contribs.get("add") or {}
        update_ops = contribs.get("update") or []
        remove_ops = contribs.get("remove") or []
    else:
        add_data, update_ops, remove_ops = contribs, [], []

    added = updated = removed = skipped = 0
    touched_videos: set[str] = set()

    for bv, locs in (add_data or {}).items():
        if not isinstance(locs, list) or not locs:
            continue
        existing = target.setdefault(bv, [])
        existing_urls = {l.get("google_maps_url") for l in existing if isinstance(l, dict)}
        for loc in locs:
            if not isinstance(loc, dict):
                continue
            url = (loc.get("google_maps_url") or "").strip()
            if not url or url in existing_urls:
                skipped += 1
                continue
            clean = {k: loc[k] for k in ALLOWED_KEYS if k in loc}
            if args.contributor:
                clean["contributor"] = args.contributor
            existing.append(clean)
            existing_urls.add(url)
            added += 1
            touched_videos.add(bv)

    for op in update_ops:
        if not isinstance(op, dict):
            continue
        bv = op.get("bv")
        match_url = op.get("match_url")
        patch = op.get("set") or {}
        if not isinstance(bv, str) or not isinstance(match_url, str) or not isinstance(patch, dict):
            continue
        pins = target.get(bv) or []
        for p in pins:
            if isinstance(p, dict) and p.get("google_maps_url") == match_url:
                for k in ALLOWED_KEYS:
                    if k in patch:
                        p[k] = patch[k]
                if args.contributor:
                    p["last_edited_by"] = args.contributor
                updated += 1
                touched_videos.add(bv)
                break

    for op in remove_ops:
        if not isinstance(op, dict):
            continue
        bv = op.get("bv")
        match_url = op.get("match_url")
        if not isinstance(bv, str) or not isinstance(match_url, str):
            continue
        pins = target.get(bv) or []
        for i, p in enumerate(pins):
            if isinstance(p, dict) and p.get("google_maps_url") == match_url:
                pins.pop(i)
                removed += 1
                touched_videos.add(bv)
                break
        if bv in target and not target[bv]:
            del target[bv]

    print(f"contributor file: {contribs_path}")
    print(f"target:           {target_path.relative_to(REPO) if target_path.is_relative_to(REPO) else target_path}")
    print(f"added:            {added}")
    print(f"updated:          {updated}")
    print(f"removed:          {removed}")
    print(f"skipped (dup):    {skipped}")
    if touched_videos:
        print(f"videos touched:   {', '.join(sorted(touched_videos))}")

    if args.dry_run:
        print("dry run — not written")
        return 0

    if added == updated == removed == 0:
        print("nothing to do — not written")
        return 0

    tmp = target_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(target, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(target_path)
    print(f"wrote {target_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
