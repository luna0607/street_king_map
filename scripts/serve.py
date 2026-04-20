#!/usr/bin/env python3
"""Dev server: serves repo root as static + accepts writes to data/locations.json.

Routes:
  POST /api/locations   body = JSON object; atomically overwrites data/locations.json
  GET  anything else    falls through to static file serving

Bound to 127.0.0.1 only; no auth (single-user local tool).
"""

import json
import socketserver
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LOCATIONS = REPO / "data" / "locations.json"
MERGE_REVIEW = REPO / "data" / "merge_review.json"
DEFAULT_PORT = 8000


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO), **kwargs)

    def end_headers(self):
        # Defeat browser caching during development so edits appear on reload.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def do_POST(self):  # noqa: N802 (stdlib name)
        if self.path == "/api/locations":
            self._save_json(LOCATIONS, expect="object")
            return
        if self.path == "/api/merge_review":
            self._save_json(MERGE_REVIEW, expect="array")
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def _save_json(self, target: Path, expect: str) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b""
        try:
            data = json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": f"invalid JSON: {exc}"})
            return
        if expect == "object" and not isinstance(data, dict):
            self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "expected JSON object"})
            return
        if expect == "array" and not isinstance(data, list):
            self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "expected JSON array"})
            return

        tmp = target.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(target)
        self.log_message("saved %s (%d items)", target.name, len(data))
        self._json(HTTPStatus.OK, {"ok": True, "items": len(data)})

    def _json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    with socketserver.ThreadingTCPServer(("127.0.0.1", port), Handler) as server:
        server.allow_reuse_address = True
        print(f"street_king_map dev server: http://127.0.0.1:{port}")
        print(f"  admin: http://127.0.0.1:{port}/web/admin.html")
        print(f"  merge: http://127.0.0.1:{port}/web/merge_review.html")
        print(f"  map:   http://127.0.0.1:{port}/web/index.html")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nbye")
    return 0


if __name__ == "__main__":
    sys.exit(main())
