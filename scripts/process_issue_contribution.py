#!/usr/bin/env python3
"""GitHub Action step: parse a contribution issue body, merge into data/locations.json.

Supports two contribution JSON formats:
  - Structured (add/update/remove):
      { "add": { "BV1xxx": [ {...}, ... ] },
        "update": [ { "bv": "BV1xxx", "match_url": "...", "set": {...} } ],
        "remove": [ { "bv": "BV1xxx", "match_url": "..." } ] }
  - Legacy (flat additions):
      { "BV1xxx": [ {...}, ... ] }

Env vars (set by the workflow):
  ISSUE_BODY      raw issue body
  ISSUE_AUTHOR    GitHub login of the issue author
  ISSUE_NUMBER    issue number (for logs)
  GITHUB_OUTPUT   path to the GitHub Actions outputs file (auto)

Writes step outputs:
  ok        'true' | 'false'
  error     error message (when ok=false)
  added     number of pins added
  updated   number of pins updated
  removed   number of pins removed
  skipped   number of duplicate adds skipped

Always exits 0 so the workflow can continue to the report-failure step.
"""

import json
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LOCATIONS = REPO / "data" / "locations.json"
MAX_BODY_BYTES = 500_000

ALLOWED_KEYS = ("place_name", "google_maps_url", "comment", "lat", "lng")


def set_output(name: str, value) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    sanitized = str(value).replace("\r", "").replace("\n", " ")
    if not path:
        print(f"::output::{name}={sanitized}")
        return
    with open(path, "a", encoding="utf-8") as f:
        f.write(f"{name}={sanitized}\n")


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    set_output("ok", "false")
    set_output("error", msg[:500])
    sys.exit(0)


def extract_json(body: str) -> str:
    """Prefer fenced ``` / ```json blocks; fall back to the whole body."""
    m = re.search(r"```(?:json)?\s*\n?(.*?)```", body, flags=re.DOTALL)
    return m.group(1).strip() if m else body.strip()


def clean_loc(loc: dict) -> dict:
    return {k: loc[k] for k in ALLOWED_KEYS if k in loc}


def apply_ops(target: dict, contribs, author: str) -> dict:
    if isinstance(contribs, dict) and any(k in contribs for k in ("add", "update", "remove")):
        add_data = contribs.get("add") or {}
        update_ops = contribs.get("update") or []
        remove_ops = contribs.get("remove") or []
    elif isinstance(contribs, dict):
        # Legacy flat format is treated as all-adds.
        add_data, update_ops, remove_ops = contribs, [], []
    else:
        fail("expected a JSON object")

    added = updated = removed = skipped = 0

    # Adds
    if not isinstance(add_data, dict):
        fail("'add' must be an object keyed by BV id")
    for bv, locs in add_data.items():
        if not isinstance(bv, str) or not bv.startswith("BV"):
            continue
        if not isinstance(locs, list) or not locs:
            continue
        existing = target.setdefault(bv, [])
        existing_urls = {l.get("google_maps_url") for l in existing if isinstance(l, dict)}
        for loc in locs:
            if not isinstance(loc, dict):
                continue
            url = (loc.get("google_maps_url") or "").strip()
            if not url:
                continue
            if url in existing_urls:
                skipped += 1
                continue
            clean = clean_loc(loc)
            if author:
                clean["contributor"] = author
            existing.append(clean)
            existing_urls.add(url)
            added += 1

    # Updates
    if not isinstance(update_ops, list):
        fail("'update' must be an array")
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
                if author:
                    p["last_edited_by"] = author
                updated += 1
                break

    # Removes
    if not isinstance(remove_ops, list):
        fail("'remove' must be an array")
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
                break
        if bv in target and not target[bv]:
            del target[bv]

    return {"added": added, "updated": updated, "removed": removed, "skipped": skipped}


def main() -> None:
    body = os.environ.get("ISSUE_BODY") or ""
    author = (os.environ.get("ISSUE_AUTHOR") or "").strip()
    issue_num = (os.environ.get("ISSUE_NUMBER") or "").strip()

    if not body:
        fail("issue body is empty")
    if len(body.encode("utf-8")) > MAX_BODY_BYTES:
        fail(f"issue body is too large (>{MAX_BODY_BYTES // 1000}KB)")

    raw = extract_json(body)
    try:
        contribs = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"JSON parse error: {exc.msg} at line {exc.lineno} col {exc.colno}")

    target = {}
    if LOCATIONS.exists():
        target = json.loads(LOCATIONS.read_text(encoding="utf-8"))

    counts = apply_ops(target, contribs, author)
    total = counts["added"] + counts["updated"] + counts["removed"]
    if total == 0:
        fail(
            f"no changes to apply (added={counts['added']}, updated={counts['updated']}, "
            f"removed={counts['removed']}, skipped={counts['skipped']}, issue #{issue_num})"
        )

    LOCATIONS.write_text(
        json.dumps(target, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    set_output("ok", "true")
    for k, v in counts.items():
        set_output(k, str(v))
    print(
        f"added={counts['added']} updated={counts['updated']} "
        f"removed={counts['removed']} skipped={counts['skipped']}"
    )


if __name__ == "__main__":
    main()
