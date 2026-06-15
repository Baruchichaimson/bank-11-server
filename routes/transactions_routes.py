from flask import Blueprint
from middleware.auth import authenticate_token, require_verified_user
from controllers.transactions_controller import (
    create_transaction,
    get_transactions,
    get_transaction_by_id,
    get_sent_transaction_by_recipient_name,
)

transactions_bp = Blueprint("transactions", __name__)

_auth = lambda f: authenticate_token(require_verified_user(f))

transactions_bp.post("")(_auth(create_transaction))
transactions_bp.get("")( _auth(get_transactions))
transactions_bp.get("/by-recipient-name/<recipient_name>")(
    _auth(get_sent_transaction_by_recipient_name)
)
transactions_bp.get("/<transaction_id>")(
    _auth(get_transaction_by_id)
)
