#!/usr/bin/env python3
"""
Build the game into a static bundle suitable for Cloudflare Pages (or any CDN).
"""

from __future__ import annotations

import shutil
from pathlib import Path

from jinja2 import Environment, FileSystemLoader


BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"


def _url_for_static(endpoint: str, *, filename: str) -> str:
    """Minimal `url_for` replacement that only understands the static endpoint."""
    if endpoint != "static":
        msg = "Only the 'static' endpoint is supported when exporting."
        raise ValueError(msg)
    return f"./static/{filename}"


def build_static_site() -> None:
    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True)

    env = Environment(loader=FileSystemLoader(TEMPLATES_DIR))
    template = env.get_template("index.html")
    rendered = template.render(url_for=_url_for_static)

    output_file = DIST_DIR / "index.html"
    output_file.write_text(rendered, encoding="utf-8")

    shutil.copytree(STATIC_DIR, DIST_DIR / "static")


def main() -> None:
    build_static_site()
    print(f"Static build ready in {DIST_DIR}")


if __name__ == "__main__":
    main()
