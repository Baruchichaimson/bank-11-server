import re


def is_valid_email(email: str) -> bool:
    return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email))


def is_valid_phone(phone: str) -> bool:
    """Israeli mobile number: 05XXXXXXXX (10 digits starting with 05)."""
    return bool(re.match(r"^05\d{8}$", phone))
