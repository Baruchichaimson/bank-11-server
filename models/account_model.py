"""
Account model — PyMongo wrapper.

Collection: accounts
Unique index: userId
"""

import random
from datetime import datetime, timezone
from bson import ObjectId
from config.db import get_db

COLLECTION = "accounts"


def _col():
    return get_db()[COLLECTION]


def _ensure_indexes():
    _col().create_index("userId", unique=True)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_account(user_id, status: str = "PENDING") -> dict:
    now = _now()
    balance = random.randint(100, 5000)
    doc = {
        "userId": ObjectId(str(user_id)),
        "status": status,
        "balance": balance,
        "createdAt": now,
        "updatedAt": now,
    }
    result = _col().insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


def find_account_by_user_id(user_id) -> dict | None:
    try:
        oid = ObjectId(str(user_id))
    except Exception:
        return None
    return _col().find_one({"userId": oid})


def find_account_by_id(account_id) -> dict | None:
    try:
        oid = ObjectId(str(account_id))
    except Exception:
        return None
    return _col().find_one({"_id": oid})


def update_account_status(account_id, status: str) -> dict | None:
    try:
        oid = ObjectId(str(account_id))
    except Exception:
        return None
    return _col().find_one_and_update(
        {"_id": oid},
        {"$set": {"status": status, "updatedAt": _now()}},
        return_document=True,
    )


def save_account(account: dict) -> dict:
    account["updatedAt"] = _now()
    oid = account["_id"]
    update_doc = {k: v for k, v in account.items() if k != "_id"}
    _col().update_one({"_id": oid}, {"$set": update_doc})
    return account


def delete_pending_accounts_by_user_ids(user_ids: list) -> dict:
    result = _col().delete_many(
        {
            "userId": {"$in": [ObjectId(str(uid)) for uid in user_ids]},
            "status": "PENDING",
        }
    )
    return {"deletedCount": result.deleted_count}
