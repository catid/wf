from __future__ import annotations

from pathlib import Path

from flask import Flask, render_template


BASE_DIR = Path(__file__).resolve().parent

app = Flask(
    __name__,
    static_folder=str(BASE_DIR / "static"),
    template_folder=str(BASE_DIR / "templates"),
)


@app.route("/")
def index() -> str:
    return render_template("index.html")


def main() -> None:
    # Enable Flask's built-in reloader for local iteration.
    app.run(host="0.0.0.0", port=8000, debug=True)


if __name__ == "__main__":
    main()
