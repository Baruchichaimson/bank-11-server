"""
Auth middleware — Flask equivalents of authenticateToken and requireVerifiedUser.
"""

from functools import wraps
import jwt
from flask import request, g, jsonify
from config.settings import JWT_SECRET
import models.user_model as _user_model

AUTH_COOKIE_NAME = "access_token"


def _get_token_from_request() -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if auth_header and isinstance(auth_header, str):
        parts = auth_header.split(" ", 1)
        if len(parts) == 2 and parts[0] == "Bearer" and parts[1].strip():
            return parts[1].strip()

    cookie_token = request.cookies.get(AUTH_COOKIE_NAME)
    if cookie_token:
        return cookie_token

    return None


def authenticate_token(f):
    """Decorator: verify JWT, attach payload to g.user and g.user_id."""

    @wraps(f)
    def decorated(*args, **kwargs):
        token = _get_token_from_request()

        if not token:
            return jsonify({"message": "Authorization token missing"}), 401

        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        except jwt.PyJWTError:
            return jsonify({"message": "Invalid or expired token"}), 401

        g.user = payload
        g.user_id = str(payload.get("userId", ""))
        return f(*args, **kwargs)

    return decorated


def require_verified_user(f):
    """
    Decorator: must run AFTER authenticate_token.
    Loads full user from DB, checks isVerified and tokenVersion.
    """

    @wraps(f)
    def decorated(*args, **kwargs):
        user_id = getattr(g, "user_id", None)
        if not user_id:
            return jsonify({"message": "Authorization token missing"}), 401

        user = _user_model.find_user_by_id(user_id)
        if not user:
            return jsonify({"message": "User not found"}), 404

        if not user.get("isVerified"):
            return jsonify({"message": "User is not verified"}), 403

        token_version_jwt = int(g.user.get("tokenVersion") or 0)
        token_version_db = int(user.get("tokenVersion") or 0)
        if token_version_jwt != token_version_db:
            return jsonify({"message": "Session is no longer valid"}), 401

        g.user_record = user
        return f(*args, **kwargs)

    return decorated
