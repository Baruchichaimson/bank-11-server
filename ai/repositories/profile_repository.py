from bson import ObjectId
from config.db import get_db


class ProfileRepository:
    def _col(self):
        return get_db()["users"]

    def find_user_by_id(self, user_id):
        try:
            oid = ObjectId(str(user_id))
        except Exception:
            return None
        doc = self._col().find_one({"_id": oid})
        if doc:
            doc.pop("password", None)
        return doc

    def find_user_by_email(self, email: str):
        doc = self._col().find_one({"email": str(email or "").lower().strip()})
        if doc:
            doc.pop("password", None)
        return doc
