"""
Transactions controller — port of transactionsController.js.
"""

import asyncio

from flask import request, jsonify, g
from models.user_model import find_user_by_email
from models.account_model import find_account_by_user_id, find_account_by_id
from models.transaction_model import (
    transfer_money,
    get_transactions_by_user_email,
    find_transactions_by_user_id,
    find_transaction_by_id,
    find_transactions_with_counterparty_name,
)
from services.risk_service import assess_transfer_risk
from utils.mongo_json import serialize_doc

EXECUTION_RISK_BLOCK_MESSAGE = "Transfer requires additional review."


def _chat_completion_fn():
    try:
        from ai.assistant.chat_assistant import _create_chat_completion, has_openai_key
        from ai.assistant.openai_client import openai_client
        if has_openai_key and openai_client:
            return _create_chat_completion
    except Exception:
        pass
    return None


def run_transfer_execution_risk(
    *,
    sender_user: dict,
    receiver_user: dict,
    sender_account: dict,
    receiver_account: dict,
    amount: float,
    description: str | None,
    services=None,
    create_chat_completion=None,
    abort_signal=None,
) -> dict:
    from ai.services.transfer_risk_gate import evaluate_transfer_execution_risk

    if services is None:
        from ai.services.business_services import create_business_services
        services = create_business_services()

    async def _evaluate():
        return await evaluate_transfer_execution_risk(
            sender_user=sender_user,
            receiver_user=receiver_user,
            sender_account=sender_account,
            receiver_account=receiver_account,
            amount=amount,
            description=description,
            services=services,
            create_chat_completion=create_chat_completion if create_chat_completion is not None else _chat_completion_fn(),
            abort_signal=abort_signal,
        )

    return asyncio.run(_evaluate())


# ---------------------------------------------------------------------------
# POST /api/v1/transactions
# ---------------------------------------------------------------------------

def create_transaction():
    try:
        data = request.get_json(silent=True) or {}
        receiver_email = data.get("receiverEmail")
        amount = data.get("amount")
        description = data.get("description")
        risk_confirmed = data.get("riskConfirmed")

        try:
            numeric_amount = float(amount)
        except (ValueError, TypeError):
            numeric_amount = None

        sender_user_id = g.user_id
        sender_email = str(g.user.get("email") or "").lower().strip()
        normalized_receiver = str(receiver_email or "").lower().strip()

        if not normalized_receiver or numeric_amount is None or not isinstance(numeric_amount, float) or not (numeric_amount == numeric_amount):
            return jsonify({"message": "receiverEmail and amount are required"}), 400

        if numeric_amount <= 0:
            return jsonify({"message": "Amount must be greater than zero"}), 400

        if sender_email and normalized_receiver == sender_email:
            return jsonify({"message": "receiver and sender are equal"}), 400

        receiver_user = find_user_by_email(normalized_receiver)
        if not receiver_user:
            return jsonify({"message": "User not found"}), 404

        if str(receiver_user["_id"]) == str(sender_user_id):
            return jsonify({"message": "receiver and sender are equal"}), 400

        sender_account = find_account_by_user_id(sender_user_id)
        receiver_account = find_account_by_user_id(receiver_user["_id"])

        if not sender_account or not receiver_account:
            return jsonify({"message": "Account not found"}), 404

        risk_assessment = assess_transfer_risk(
            sender_email=sender_email,
            receiver_email=normalized_receiver,
            amount=numeric_amount,
            sender_balance=sender_account.get("balance", 0),
        )

        if numeric_amount > 1000 and not risk_confirmed:
            return jsonify(
                {
                    "message": "Additional confirmation required for amount above 1000 ILS",
                    "requiresAdditionalConfirmation": True,
                    "confirmationThreshold": 1000,
                    "riskAssessment": risk_assessment,
                }
            ), 409

        execution_risk = run_transfer_execution_risk(
            sender_user=g.user,
            receiver_user=receiver_user,
            sender_account=sender_account,
            receiver_account=receiver_account,
            amount=numeric_amount,
            description=description,
        )
        risk_decision = execution_risk.get("riskDecision") or {}
        if risk_decision.get("allowed") is not True:
            return jsonify(
                {
                    "message": EXECUTION_RISK_BLOCK_MESSAGE,
                    "riskDecision": risk_decision,
                }
            ), 403

        transaction = transfer_money(
            from_account_id=sender_account["_id"],
            to_account_id=receiver_account["_id"],
            amount=numeric_amount,
            description=description,
        )

        updated_sender = find_account_by_id(sender_account["_id"])
        updated_receiver = find_account_by_id(receiver_account["_id"])

        return jsonify(
            {
                "message": "Transaction completed",
                "senderBalance": updated_sender.get("balance") if updated_sender else None,
                "receiverBalance": updated_receiver.get("balance") if updated_receiver else None,
                "riskAssessment": risk_assessment,
                "riskDecision": risk_decision,
                "transaction": serialize_doc(transaction),
            }
        ), 201

    except Exception as err:
        return jsonify({"message": str(err) or "Transaction failed"}), 400


# ---------------------------------------------------------------------------
# GET /api/v1/transactions
# ---------------------------------------------------------------------------

def get_transactions():
    email = g.user.get("email")

    parsed_limit = request.args.get("limit", "")
    parsed_offset = request.args.get("offset", "")

    try:
        limit = int(parsed_limit)
        if limit <= 0:
            limit = None
    except (ValueError, TypeError):
        limit = None

    try:
        offset = int(parsed_offset)
        if offset < 0:
            offset = 0
    except (ValueError, TypeError):
        offset = 0

    # Fetch one extra document to cheaply detect whether more exist.
    query_limit = (limit + 1) if limit else None
    raw = get_transactions_by_user_email(email, limit=query_limit, offset=offset)

    docs = [
        {**serialize_doc(dict(tx)), "sign": "-" if tx.get("fromEmail") == email else "+"}
        for tx in raw
    ]

    has_more = (limit is not None) and len(docs) > limit
    page = docs[:limit] if has_more else docs

    # Always return the pagination envelope so clients can rely on a
    # consistent shape regardless of whether a limit was supplied.
    return jsonify(
        {
            "transactions": page,
            "pagination": {"limit": limit, "offset": offset, "hasMore": has_more},
        }
    ), 200


# ---------------------------------------------------------------------------
# GET /api/v1/transactions/<transactionId>
# ---------------------------------------------------------------------------

def get_transaction_by_id(transaction_id: str):
    transaction = find_transaction_by_id(transaction_id)
    if not transaction:
        return jsonify({"message": "Transaction not found"}), 404
    return jsonify(serialize_doc(transaction)), 200


# ---------------------------------------------------------------------------
# GET /api/v1/transactions/by-recipient-name/<recipientName>
# ---------------------------------------------------------------------------

def get_sent_transaction_by_recipient_name(recipient_name: str):
    if not (recipient_name or "").strip():
        return jsonify({"message": "recipientName is required"}), 400

    transactions = find_transactions_with_counterparty_name(g.user_id, recipient_name)

    if not transactions:
        return jsonify({"message": "Transaction not found"}), 404

    return jsonify([serialize_doc(dict(tx)) for tx in transactions]), 200
