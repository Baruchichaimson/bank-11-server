"""
Rate limiting middleware — Flask-Limiter equivalents of Express rate limiters.

A module-level Limiter instance is created here so that route files can safely
import the decorator factories at import time, before init_limiter(app) is
called.  Flask-Limiter supports this pattern: the Limiter is created without an
app reference, then wired to the app via init_app() (identical to the
Flask-SQLAlchemy / Flask-Login convention).
"""

from flask import request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

RETRY_MESSAGE = "Too many attempts. You can continue trying again in one minute."


def _user_and_ip_key() -> str:
    email = str(request.json.get("email", "") if request.is_json else "").strip().lower()
    ip = get_remote_address()
    return f"{ip}:{email or 'unknown-email'}"


# Module-level instance — safe to import before app creation.
# Storage defaults to in-memory; override with storage_uri for production Redis.
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[],
    storage_uri="memory://",
)


def init_limiter(app) -> Limiter:
    """Wire the module-level limiter to a Flask app.  Call once during app setup."""
    from flask import jsonify

    limiter.init_app(app)

    @app.errorhandler(429)
    def _ratelimit_handler(e):
        return jsonify({"message": RETRY_MESSAGE}), 429

    return limiter


# Limit decorators — all arguments must be hashable (strings, callables).
# error_message is a plain string here; the JSON shape is produced by the
# 429 error handler registered in init_limiter().

def auth_login_limit():
    return limiter.limit("5 per minute", key_func=_user_and_ip_key, error_message=RETRY_MESSAGE)


def auth_signup_limit():
    return limiter.limit("5 per minute", key_func=_user_and_ip_key, error_message=RETRY_MESSAGE)


def auth_forgot_password_limit():
    return limiter.limit("3 per minute", error_message=RETRY_MESSAGE)


def auth_reset_password_limit():
    return limiter.limit("3 per minute", error_message=RETRY_MESSAGE)
