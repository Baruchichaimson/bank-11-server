from flask import Blueprint

from controllers.users_controller import get_my_avatar
from middleware.auth import authenticate_token, require_verified_user

users_bp = Blueprint("users", __name__)

users_bp.get("/me/avatar")(authenticate_token(require_verified_user(get_my_avatar)))
