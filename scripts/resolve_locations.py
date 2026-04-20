#!/usr/bin/env python3
"""Resolve Google Maps URLs in data/locations.json into lat/lng.

- Handles desktop Maps URLs that already embed coords (@lat,lng, !3d!4d, q=/ll=).
- For short URLs (maps.app.goo.gl, goo.gl/maps) follows the redirect and
  re-parses the resolved target.

Run repeatedly — already-resolved entries are left alone.
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_PATH = REPO / "data" / "locations.json"

COORD_PATTERNS = [
    re.compile(r"@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)"),
    re.compile(r"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)"),
    re.compile(r"[?&](?:q|ll|center|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)"),
]


def parse_coords(url: str) -> tuple[float, float] | None:
    for pat in COORD_PATTERNS:
        m = pat.search(url)
        if m:
            try:
                return float(m.group(1)), float(m.group(2))
            except ValueError:
                continue
    return None


def resolve_url(url: str, timeout: float = 10.0) -> str:
    """Follow redirects for short links; return the final URL."""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; street_king_map/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.geturl()


def extract_coords(url: str) -> tuple[tuple[float, float] | None, str]:
    """Return (coords, resolved_url)."""
    coords = parse_coords(url)
    if coords is not None:
        return coords, url
    # Try following redirects for short links.
    try:
        resolved = resolve_url(url)
    except Exception as exc:
        print(f"  ! failed to follow {url}: {exc}", file=sys.stderr)
        return None, url
    if resolved != url:
        return parse_coords(resolved), resolved
    return None, resolved


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("path", nargs="?", default=str(DEFAULT_PATH),
                    help=f"locations.json path (default: {DEFAULT_PATH.relative_to(REPO)})")
    ap.add_argument("--force", action="store_true",
                    help="re-resolve entries that already have lat/lng")
    args = ap.parse_args(argv[1:])

    path = Path(args.path)
    if not path.is_absolute():
        path = REPO / path
    data = json.loads(path.read_text(encoding="utf-8"))

    touched = 0
    already = 0
    failed = 0
    for bv, locs in data.items():
        for loc in locs:
            url = loc.get("google_maps_url", "").strip()
            if not url:
                continue
            has_coords = (
                isinstance(loc.get("lat"), (int, float))
                and isinstance(loc.get("lng"), (int, float))
            )
            if has_coords and not args.force:
                already += 1
                continue
            coords, resolved = extract_coords(url)
            if resolved != url:
                loc["resolved_url"] = resolved
            if coords is None:
                failed += 1
                print(f"  ! no coords for {bv}: {url}", file=sys.stderr)
                continue
            loc["lat"], loc["lng"] = coords
            touched += 1

    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"resolved: {touched}, already had coords: {already}, failed: {failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
