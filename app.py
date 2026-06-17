"""
Flask + ASGI application entry point — port of server.js.

Run with:
    python app.py
    uvicorn app:asgi_app --host 0.0.0.0 --port $PORT
    gunicorn app:asgi_app --bind 0.0.0.0:$PORT -k uvicorn.workers.UvicornWorker
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv()

from flask import Flask
from flask_cors import CORS

from config.settings import PORT
from config.cors_origins import get_allowed_origins
from middleware.security_headers import apply_security_headers
from middleware.rate_limit import init_limiter
from routes.health_routes import health_bp
from routes.auth_routes import auth_bp
from routes.accounts_routes import accounts_bp
from routes.transactions_routes import transactions_bp


def create_app(testing: bool = False) -> Flask:
    """
    Application factory.

    Called by:
    - module-level `flask_app = create_app()` below
    - tests/conftest.py                         → pytest
    """
    flask_app = Flask(__name__)

    if testing:
        flask_app.config["TESTING"] = True

    # CORS — mirrors Express cors({ origin: ..., credentials: true })
    CORS(
        flask_app,
        origins=get_allowed_origins(),
        supports_credentials=True,
        allow_headers=["Content-Type", "Authorization"],
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    )

    # Security headers (Helmet equivalent)
    apply_security_headers(flask_app)

    # Rate limiter — must be initialised before blueprints are registered so
    # that the per-route decorators are bound to this app.
    init_limiter(flask_app)

    # Blueprints — url_prefix must match the frontend's API contract exactly.
    flask_app.register_blueprint(health_bp,       url_prefix="/api/v1/health")
    flask_app.register_blueprint(auth_bp,          url_prefix="/api/v1/auth")
    flask_app.register_blueprint(accounts_bp,      url_prefix="/api/v1/accounts")
    flask_app.register_blueprint(transactions_bp,  url_prefix="/api/v1/transactions")

    return flask_app


def _connect_and_start_jobs():
    from config.db import connect_mongodb
    from utils.pending_registration_cleanup import start_pending_registration_cleanup
    connect_mongodb()
    start_pending_registration_cleanup()


# Connect to MongoDB and start background jobs on import.
# Wrapped in a guard so that `from app import create_app` in tests does NOT
# trigger a real MongoDB connection (tests set MONGO_URI to a local address
# and mock the DB at the model layer anyway).
if not os.environ.get("FLASK_TESTING"):
    _connect_and_start_jobs()

flask_app = create_app()

from realtime.socket_server import create_socket_asgi_app

asgi_app = create_socket_asgi_app(flask_app)

# Backwards-compatible WSGI name for Flask-only tooling/tests.
app = flask_app

if __name__ == "__main__":
    import uvicorn

    sys.stderr.write(f"[app] Starting ASGI server on 0.0.0.0:{PORT}\n")
    sys.stderr.flush()
    uvicorn.run(asgi_app, host="0.0.0.0", port=PORT)
