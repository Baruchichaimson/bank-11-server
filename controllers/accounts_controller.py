"""
Accounts controller — port of accountsController.js.
"""

from flask import request, jsonify, g
from models.account_model import find_account_by_user_id
from models.transaction_model import find_transactions_by_user_id
from utils.mongo_json import serialize_doc


def get_account():
    try:
        user_id = g.user_id
        user_email = str(g.user.get("email") or "").lower()

        parsed_limit = request.args.get("transactionsLimit", "")
        parsed_offset = request.args.get("transactionsOffset", "")

        try:
            transactions_limit = int(parsed_limit)
            if transactions_limit <= 0:
                transactions_limit = 5
        except (ValueError, TypeError):
            transactions_limit = 5

        try:
            transactions_offset = int(parsed_offset)
            if transactions_offset < 0:
                transactions_offset = 0
        except (ValueError, TypeError):
            transactions_offset = 0

        account = find_account_by_user_id(user_id)
        if not account:
            return jsonify({"message": "Account not found"}), 404

        transactions = find_transactions_by_user_id(
            user_id, limit=transactions_limit, offset=transactions_offset
        )

        transactions_with_sign = []
        for tx in transactions:
            tx_copy = dict(tx)
            from_email = str(tx_copy.get("fromEmail") or "").lower()
            to_email = str(tx_copy.get("toEmail") or "").lower()
            if from_email == user_email:
                sign = "-"
            elif to_email == user_email:
                sign = "+"
            else:
                sign = ""
            tx_copy["sign"] = sign
            transactions_with_sign.append(serialize_doc(tx_copy))

        return jsonify(
            {
                "account": serialize_doc(account),
                "transactions": transactions_with_sign,
                "pagination": {
                    "limit": transactions_limit,
                    "offset": transactions_offset,
                },
            }
        ), 200

    except Exception as err:
        print(f"GET ACCOUNT ERROR: {err}")
        return jsonify({"message": "Server error"}), 500
