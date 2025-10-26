from __future__ import annotations

from pathlib import Path

from flask import Flask, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
DIST_DIR = BASE_DIR / "dist"

app = Flask(
    __name__,
    static_folder=str(DIST_DIR / "static"),
    static_url_path="/static",
)


@app.route("/")
def index() -> str:
    return send_from_directory(DIST_DIR, "index.html")


def main() -> None:
    # Enable Flask's built-in reloader for local iteration.
    app.run(host="0.0.0.0", port=8000, debug=True)


if __name__ == "__main__":
    main()
