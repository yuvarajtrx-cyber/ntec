import os

from dotenv import load_dotenv
from flask import Flask

from app.web.admin_routes import register_admin_routes
from app.domain.auth import init_auth, register_auth_routes
from app.web.export_routes import register_export_routes
from app.web.profile_routes import register_profile_routes
from app.domain.quality import register_quality_routes
from app.web.sales_routes import register_sales_routes
from app.web.static_routes import register_static_routes
from app.web.web_helpers import register_security_headers


def create_app() -> Flask:
    load_dotenv()
    app = Flask(__name__, static_folder=None)
    init_auth(app)
    register_security_headers(app)
    register_auth_routes(app)
    register_export_routes(app)
    register_quality_routes(app)
    register_sales_routes(app)
    register_profile_routes(app)
    register_admin_routes(app)
    register_static_routes(app)
    return app


app = create_app()


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "false").lower() in ("1", "true", "yes")
    app.run(host="127.0.0.1", port=5050, debug=debug)
