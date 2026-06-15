from bson import ObjectId
from config.db import get_db


class AccountRepository:
    def _col(self):
        return get_db()["accounts"]

    def find_account_by_user_id(self, user_id):
        try:
            oid = ObjectId(str(user_id))
        except Exception:
            return None
        return self._col().find_one({"userId": oid})

    def find_account_by_id(self, account_id):
        try:
            oid = ObjectId(str(account_id))
        except Exception:
            return None
        return self._col().find_one({"_id": oid})
