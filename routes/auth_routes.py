from flask import Blueprint
from controllers.auth_controller import (
    signup,
    login,
    verify,
    logout,
    forgot_password,
    reset_password,
    open_reset_password_page,
)
from middleware.rate_limit import (
    auth_signup_limit,
    auth_login_limit,
    auth_forgot_password_limit,
    auth_reset_password_limit,
)

auth_bp = Blueprint("auth", __name__)

auth_bp.post("/signup")(auth_signup_limit()(signup))
auth_bp.post("/login")(auth_login_limit()(login))
auth_bp.get("/verify")(verify)
auth_bp.post("/logout")(logout)
auth_bp.post("/forgot-password")(auth_forgot_password_limit()(forgot_password))
auth_bp.get("/reset-password/<token>")(open_reset_password_page)
auth_bp.get("/reset-password")(open_reset_password_page)
auth_bp.post("/reset-password")(auth_reset_password_limit()(reset_password))
