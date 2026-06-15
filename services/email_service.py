"""
Email service facade — delegates to utils/email_service.py.
"""

from utils.email_service import send_verification_email, send_password_reset_email

__all__ = ["send_verification_email", "send_password_reset_email"]
