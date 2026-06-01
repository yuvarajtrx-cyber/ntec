from pathlib import Path

from flask import send_from_directory

# Static assets live at the repo root (app/web/static_routes.py -> parents[2]).
HERE = Path(__file__).resolve().parents[2]


def register_static_routes(app) -> None:
    @app.get("/")
    def index():
        return send_from_directory(HERE, "index.html")

    @app.get("/css/<path:filename>")
    def css_file(filename):
        return send_from_directory(HERE / "css", filename)

    @app.get("/js/<path:filename>")
    def js_file(filename):
        return send_from_directory(HERE / "js", filename)

    @app.get("/pages/<path:filename>")
    def page_file(filename):
        return send_from_directory(HERE / "pages", filename)
