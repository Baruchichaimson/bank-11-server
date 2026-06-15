"""
User model — PyMongo wrapper preserving Mongoose schema field names and behaviour.

Collection: users
Unique indexes: email, phoneNumber
password field is excluded by default (select: false equivalent).
"""

from datetime import datetime, timezone
from bson import ObjectId
from config.db import get_db

COLLECTION = "users"


def _col():
    return get_db()[COLLECTION]


def _ensure_indexes():
    col = _col()
    col.create_index("email", unique=True)
    col.create_index("phoneNumber", unique=True)
    col.create_index("verificationToken", sparse=True)
    col.create_index("resetPasswordToken", sparse=True)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _strip_password(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    result = dict(doc)
    result.pop("password", None)
    return result


# ---------------------------------------------------------------------------
# CRUD helpers
# ---------------------------------------------------------------------------

def create_user(data: dict) -> dict:
    now = _now()
    doc = {
        "firstName": str(data.get("firstName", "")).strip(),
        "lastName": str(data.get("lastName", "")).strip(),
        "email": str(data.get("email", "")).lower().strip(),
        "phoneNumber": str(data.get("phoneNumber", "")).strip(),
        "password": data.get("password", ""),
        "isVerified": bool(data.get("isVerified", False)),
        "verificationToken": data.get("verificationToken"),
        "verificationExpires": data.get("verificationExpires"),
        "resetPasswordToken": None,
        "resetPasswordExpires": None,
        "tokenVersion": int(data.get("tokenVersion", 0)),
        "createdAt": now,
        "updatedAt": now,
    }
    result = _col().insert_one(doc)
    doc["_id"] = result.inserted_id
    return _strip_password(doc)


def find_user_by_email(email: str) -> dict | None:
    doc = _col().find_one({"email": str(email or "").lower().strip()})
    return _strip_password(doc)


def find_user_by_phone_number(phone: str) -> dict | None:
    doc = _col().find_one({"phoneNumber": str(phone or "").strip()})
    return _strip_password(doc)


def find_verified_user_by_email(email: str) -> dict | None:
    doc = _col().find_one({"email": str(email or "").lower().strip(), "isVerified": True})
    return _strip_password(doc)


def find_user_by_email_with_password(email: str) -> dict | None:
    """Returns the user document including the password field."""
    return _col().find_one({"email": str(email or "").lower().strip()})


def find_user_by_id(user_id) -> dict | None:
    try:
        oid = ObjectId(str(user_id))
    except Exception:
        return None
    doc = _col().find_one({"_id": oid})
    return _strip_password(doc)


def find_user_by_verification_token(token: str) -> dict | None:
    doc = _col().find_one({"verificationToken": token})
    return _strip_password(doc)


def find_user_by_reset_token(token: str) -> dict | None:
    """Returns user including password (needed for reset logic)."""
    return _col().find_one({"resetPasswordToken": token})


def save_user(user: dict) -> dict:
    """Persist mutations made to an in-memory user dict back to MongoDB."""
    user["updatedAt"] = _now()
    oid = user["_id"]
    update_doc = {k: v for k, v in user.items() if k != "_id"}
    _col().update_one({"_id": oid}, {"$set": update_doc})
    return user


def bump_token_version_by_id(user_id) -> dict | None:
    try:
        oid = ObjectId(str(user_id))
    except Exception:
        return None
    result = _col().find_one_and_update(
        {"_id": oid},
        {"$inc": {"tokenVersion": 1}, "$set": {"updatedAt": _now()}},
        return_document=True,
    )
    return _strip_password(result)


def find_expired_unverified_users(now: datetime | None = None) -> list[dict]:
    now = now or _now()
    return list(
        _col().find(
            {"isVerified": False, "verificationExpires": {"$lte": now}},
            {"_id": 1},
        )
    )


def delete_expired_unverified_users_by_ids(user_ids: list, now: datetime | None = None) -> dict:
    now = now or _now()
    result = _col().delete_many(
        {
            "_id": {"$in": [ObjectId(str(uid)) for uid in user_ids]},
            "isVerified": False,
            "verificationExpires": {"$lte": now},
        }
    )
    return {"deletedCount": result.deleted_count}
