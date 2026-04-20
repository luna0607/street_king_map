#!/usr/bin/env python3
"""GitHub Action step: parse a contribution issue body, merge into data/locations.json.

Env vars (set by the workflow):
  ISSUE_BODY      raw issue body
  ISSUE_AUTHOR    GitHub login of the issue author
  ISSUE_NUMBER    issue number (for logs)
  GITHUB_OUTPUT   path to the GitHub Actions outputs file (auto)

Writes step outputs:
  ok        'true' | 'false'
  error     error message (when ok=false)
  added     number of pins added
  skipped   number of duplicate pins skipped

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


def set_output(name: str, value: str) -> None:
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
    """Pick out JSON from a Markdown body.

    Prefers fenced ```json ... ``` blocks; falls back to the whole body.
    """
    m = re.search(r"```(?:json)?\s*\n?(.*?)```", body, flags=re.DOTALL)
    if m:
        return m.group(1).strip()
    return body.strip()


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

    if not isinstance(contribs, dict):
        fail("expected a JSON object keyed by BV id (e.g. { \"BV1xxx\": [ ... ] })")

    target = {}
    if LOCATIONS.exists():
        target = json.loads(LOCATIONS.read_text(encoding="utf-8"))

    added = 0
    skipped = 0
    for bv, locs in contribs.items():
        if not isinstance(bv, str) or not bv.startswith("BV"):
            continue
        if not isinstance(locs, list) or not locs:
            continue
        existing = target.setdefault(bv, [])
        existing_urls = {l.get("google_maps_url") for l in existing if isinstance(l, dict)}
        for loc in locs:
            if not isinstance(loc, dict):
                continue
            url = loc.get("google_maps_url")
            if not isinstance(url, str) or not url.strip():
                continue
            if url in existing_urls:
                skipped += 1
                continue
            # Keep a known-safe subset of fields; the bot controls 'contributor'.
            clean = {k: loc[k] for k in ("place_name", "google_maps_url", "comment", "lat", "lng")
                     if k in loc}
            if author:
                clean["contributor"] = author
            existing.append(clean)
            existing_urls.add(url)
            added += 1

    if added == 0:
        fail(f"no new pins to add (skipped {skipped} duplicates, issue #{issue_num})")

    LOCATIONS.write_text(
        json.dumps(target, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    set_output("ok", "true")
    set_output("added", str(added))
    set_output("skipped", str(skipped))
    print(f"added {added}, skipped {skipped}")


if __name__ == "__main__":
    main()
