"""
Transaction model — PyMongo wrapper.

Collection: transactions
Indexes: fromEmail+createdAt, toEmail+createdAt, id (unique numeric)
"""

import re
import time
import random
from datetime import datetime, timezone
from bson import ObjectId
from pymongo import DESCENDING, ASCENDING
from config.db import get_db

COLLECTION = "transactions"


def _col():
    return get_db()[COLLECTION]


def _ensure_indexes():
    col = _col()
    col.create_index("id", unique=True)
    col.create_index([("fromEmail", ASCENDING), ("createdAt", DESCENDING)])
    col.create_index([("toEmail", ASCENDING), ("createdAt", DESCENDING)])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _escape_regex(value: str) -> str:
    return re.escape(str(value or ""))


# ---------------------------------------------------------------------------
# Transfer money (with optional session / atomic fallback)
# ---------------------------------------------------------------------------

def transfer_money(*, from_account_id, to_account_id, amount: float, description: str | None = None) -> dict:
    """
    Perform an atomic-ish money transfer.
    PyMongo replica-set transactions require a session; we attempt one and fall
    back to a non-transactional transfer when replica sets are unavailable.
    """
    from pymongo import MongoClient
    from pymongo.errors import OperationFailure
    from config.db import get_db
    from models.account_model import _col as acct_col, _now as acct_now, find_account_by_id

    db = get_db()
    accounts = db["accounts"]
    users = db["users"]

    def _perform(session=None):
        kwargs = {"session": session} if session else {}

        from_acc = accounts.find_one({"_id": ObjectId(str(from_account_id))}, **kwargs)
        to_acc = accounts.find_one({"_id": ObjectId(str(to_account_id))}, **kwargs)

        if not from_acc or not to_acc:
            raise ValueError("Account not found")
        if str(from_acc["_id"]) == str(to_acc["_id"]):
            raise ValueError("receiver and sender are equal")
        if from_acc.get("status") != "ACTIVE":
            raise ValueError("Source account is not active")
        if from_acc.get("balance", 0) < amount:
            raise ValueError("Insufficient funds")

        from_user = users.find_one({"_id": from_acc["userId"]}, **kwargs)
        to_user = users.find_one({"_id": to_acc["userId"]}, **kwargs)

        if not from_user or not from_user.get("email"):
            raise ValueError("User email not found")
        if not to_user or not to_user.get("email"):
            raise ValueError("User email not found")

        now = _now()
        accounts.update_one(
            {"_id": from_acc["_id"]},
            {"$inc": {"balance": -amount}, "$set": {"updatedAt": now}},
            **kwargs,
        )
        accounts.update_one(
            {"_id": to_acc["_id"]},
            {"$inc": {"balance": amount}, "$set": {"updatedAt": now}},
            **kwargs,
        )

        tx_id = int(time.time() * 1000) + random.randint(0, 999)
        tx_doc = {
            "id": tx_id,
            "fromEmail": from_user["email"],
            "toEmail": to_user["email"],
            "amount": amount,
            "status": "COMPLETED",
            "description": description,
            "createdAt": now,
            "updatedAt": now,
        }
        result = _col().insert_one(tx_doc, **kwargs)
        tx_doc["_id"] = result.inserted_id
        return tx_doc

    client = db.client
    try:
        with client.start_session() as session:
            with session.start_transaction():
                return _perform(session)
    except Exception as err:
        tx_not_supported = "Transaction numbers are only allowed on a replica set" in str(err)
        if tx_not_supported:
            return _perform()
        raise


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

def get_transactions_by_user_email(email: str, *, limit=None, offset=None) -> list[dict]:
    """Query transactions directly by email — no secondary user lookup needed."""
    query = {"$or": [{"fromEmail": email}, {"toEmail": email}]}
    cursor = _col().find(query).sort("createdAt", DESCENDING)

    if offset and offset > 0:
        cursor = cursor.skip(offset)
    if limit and limit > 0:
        cursor = cursor.limit(limit)

    return list(cursor)


def find_transactions_by_user_id(user_id, *, limit=None, offset=None) -> list[dict]:
    """Legacy helper — resolves user_id to email then delegates."""
    db = get_db()
    user = db["users"].find_one({"_id": ObjectId(str(user_id))}, {"email": 1})
    if not user or not user.get("email"):
        return []
    return get_transactions_by_user_email(
        user["email"], limit=limit, offset=offset
    )


def find_transaction_by_id(transaction_id) -> dict | None:
    if ObjectId.is_valid(str(transaction_id)):
        doc = _col().find_one({"_id": ObjectId(str(transaction_id))})
        if doc:
            return doc

    try:
        numeric_id = int(transaction_id)
        return _col().find_one({"id": numeric_id})
    except (ValueError, TypeError):
        return None


def find_transactions_with_counterparty_name(user_id, recipient_name: str) -> list[dict]:
    db = get_db()
    user = db["users"].find_one({"_id": ObjectId(str(user_id))}, {"email": 1})
    if not user or not user.get("email"):
        return []

    email = user["email"]
    normalized = str(recipient_name or "").strip()
    if not normalized:
        return []

    safe = _escape_regex(normalized)
    pattern = re.compile(f"^{safe}@", re.IGNORECASE)

    return list(
        _col().find(
            {
                "$or": [
                    {"fromEmail": email, "toEmail": pattern},
                    {"fromEmail": pattern, "toEmail": email},
                ]
            }
        ).sort("createdAt", DESCENDING)
    )
