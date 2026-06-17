"""
Helpers for values that must survive JSON/msgpack serialization.
"""

from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

try:
    from bson import ObjectId
except Exception:  # pragma: no cover - bson is installed in the app runtime
    ObjectId = None


def make_json_safe(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    if ObjectId is not None and isinstance(value, ObjectId):
        return str(value)

    if isinstance(value, datetime):
        return value.isoformat()

    if isinstance(value, date):
        return value.isoformat()

    if isinstance(value, Decimal):
        return float(value)

    if isinstance(value, UUID):
        return str(value)

    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return value.hex()

    if isinstance(value, Mapping):
        return {str(k): make_json_safe(v) for k, v in value.items()}

    if isinstance(value, (list, tuple, set, frozenset)):
        return [make_json_safe(v) for v in value]

    return str(value)
