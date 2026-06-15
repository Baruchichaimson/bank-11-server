"""
Transaction service facade — thin wrapper used by the transactions controller.
"""

from models.transaction_model import (
    transfer_money,
    get_transactions_by_user_email,
    find_transactions_by_user_id,
    find_transaction_by_id,
    find_transactions_with_counterparty_name,
)

__all__ = [
    "transfer_money",
    "get_transactions_by_user_email",
    "find_transactions_by_user_id",
    "find_transaction_by_id",
    "find_transactions_with_counterparty_name",
]
