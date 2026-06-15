"""
Helpers to make MongoDB documents JSON-serialisable:
  - ObjectId → str
  - datetime → ISO string
"""

from bson import ObjectId
from datetime import datetime


def serialize_doc(doc) -> dict | list | None:
    """Recursively convert a MongoDB document to a JSON-safe dict."""
    if doc is None:
        return None
    if isinstance(doc, list):
        return [serialize_doc(item) for item in doc]
    if isinstance(doc, dict):
        return {k: _serialize_value(v) for k, v in doc.items()}
    return doc


def _serialize_value(value):
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return serialize_doc(value)
    if isinstance(value, list):
        return [_serialize_value(v) for v in value]
    return value
