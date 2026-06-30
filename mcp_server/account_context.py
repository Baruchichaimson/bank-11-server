"""Safe account context helpers for MCP resources."""

from __future__ import annotations

from models.account_model import find_account_by_user_id
from models.user_model import find_user_by_id


def build_current_account_context(user_id: str) -> dict:
    """Return safe account context for transfer/risk workflows."""
    user = find_user_by_id(user_id)
    if not user:
        raise ValueError("User not found")

    account = find_account_by_user_id(user_id)
    if not account:
        raise ValueError("Account not found")

    return {
        "userId": str(user.get("_id")),
        "userEmail": str(user.get("email") or "").strip().lower(),
        "accountId": str(account.get("_id")),
        "balance": float(account.get("balance") or 0),
        "accountSummary": {
            "status": account.get("status") or "UNKNOWN",
            "currency": "ILS",
        },
    }
