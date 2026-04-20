#!/usr/bin/env python3
"""Extract metadata from the bilibili_metadata HTML snippet into JSON.

Depends only on the Python standard library.
"""

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def strip_leading_slashes(url: str) -> str:
    return url.lstrip("/") if url else url


def to_https_link(url: str) -> str:
    if not url:
        return url
    if url.startswith(("http://", "https://")):
        return url
    return "https://" + url.lstrip("/")


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


class CardParser(HTMLParser):
    """Parse bilibili upload-video-card grid HTML into records.

    Each card yields: link, name, thumbnail, length, visit_volume,
    danmu_volume, post_date.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.entries: list[dict] = []
        self._div_stack: list[list[str]] = []
        self._card_depth: int | None = None
        self._stats_depth: int | None = None
        self._subtitle_depth: int | None = None
        self._current: dict | None = None
        self._stat_numbers: list[str] = []
        self._capture_span_into: str | None = None  # "stat" or "subtitle"
        self._subtitle_text: str = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str]]) -> None:
        attr = dict(attrs)
        classes = attr.get("class", "").split()

        if tag == "div":
            self._div_stack.append(classes)
            depth = len(self._div_stack)
            if (
                "upload-video-card" in classes
                and "grid-mode" in classes
                and self._card_depth is None
            ):
                self._card_depth = depth
                self._current = {
                    "link": "",
                    "name": "",
                    "thumbnail": "",
                    "length": "",
                    "visit_volume": "",
                    "danmu_volume": "",
                    "post_date": "",
                }
                self._stat_numbers = []
                self._subtitle_text = ""
                return

            if self._current is None:
                return

            if "bili-cover-card__stats" in classes and self._stats_depth is None:
                self._stats_depth = depth
            elif "bili-video-card__subtitle" in classes and self._subtitle_depth is None:
                self._subtitle_depth = depth
            return

        if self._current is None:
            return

        if tag == "a" and "bili-cover-card" in classes and not self._current["link"]:
            self._current["link"] = to_https_link(attr.get("href", ""))
        elif tag == "img" and not self._current["thumbnail"]:
            self._current["thumbnail"] = strip_leading_slashes(attr.get("src", ""))
            if not self._current["name"]:
                self._current["name"] = attr.get("alt", "") or ""
        elif tag == "span":
            if self._stats_depth is not None:
                self._capture_span_into = "stat"
            elif self._subtitle_depth is not None:
                self._capture_span_into = "subtitle"

    def handle_endtag(self, tag: str) -> None:
        if tag == "div":
            if not self._div_stack:
                return
            self._div_stack.pop()
            depth = len(self._div_stack) + 1  # depth that just closed

            if self._stats_depth is not None and depth == self._stats_depth:
                self._stats_depth = None
            if self._subtitle_depth is not None and depth == self._subtitle_depth:
                self._subtitle_depth = None
                if self._current is not None and not self._current["post_date"]:
                    self._current["post_date"] = clean(self._subtitle_text)
                self._subtitle_text = ""

            if (
                self._current is not None
                and self._card_depth is not None
                and depth == self._card_depth
            ):
                # Assign stats in the observed order: visit, danmu, length.
                if len(self._stat_numbers) >= 1:
                    self._current["visit_volume"] = self._stat_numbers[0]
                if len(self._stat_numbers) >= 2:
                    self._current["danmu_volume"] = self._stat_numbers[1]
                if len(self._stat_numbers) >= 3:
                    self._current["length"] = self._stat_numbers[2]
                self.entries.append(self._current)
                self._current = None
                self._card_depth = None
                self._stat_numbers = []
        elif tag == "span":
            self._capture_span_into = None

    def handle_data(self, data: str) -> None:
        if self._current is None or self._capture_span_into is None:
            return
        text = clean(data)
        if not text:
            return
        if self._capture_span_into == "stat":
            self._stat_numbers.append(text)
        elif self._capture_span_into == "subtitle":
            self._subtitle_text = (self._subtitle_text + " " + text).strip()


def extract(source: str) -> list[dict]:
    parser = CardParser()
    parser.feed(source)
    parser.close()
    return parser.entries


def process(input_path: Path, output_path: Path) -> list[dict]:
    source = input_path.read_text(encoding="utf-8")
    entries = extract(source)
    output_path.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"{input_path.name}: {len(entries)} entries -> {output_path.name}")
    return entries


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Extract bilibili upload-grid HTML to JSON.")
    ap.add_argument("inputs", nargs="+", help="HTML files (relative paths resolved against repo root)")
    ap.add_argument("--out-dir", default="data", help="where to write <name>.json files (default: data)")
    args = ap.parse_args(argv[1:])

    out_dir = Path(args.out_dir)
    if not out_dir.is_absolute():
        out_dir = REPO / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    for arg in args.inputs:
        in_path = Path(arg)
        if not in_path.is_absolute():
            in_path = REPO / in_path
        out_path = out_dir / (in_path.name + ".json")
        process(in_path, out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
