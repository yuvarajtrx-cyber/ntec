"""Windows deployment entry point.

Shares the exact same application factory as server.py, so the routes and
behaviour stay in lock-step. Keep Windows-specific run configuration (host,
port, server backend) in the __main__ block below.
"""
import os

from server import create_app

app = create_app()


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "false").lower() in ("1", "true", "yes")
    app.run(host="127.0.0.1", port=5050, debug=debug)
