from flask import Blueprint
from middleware.auth import authenticate_token, require_verified_user
from controllers.accounts_controller import get_account

accounts_bp = Blueprint("accounts", __name__)

accounts_bp.get("/me")(authenticate_token(require_verified_user(get_account)))
