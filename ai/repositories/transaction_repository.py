import re
from bson import ObjectId
from pymongo import DESCENDING, ASCENDING
from config.db import get_db


def _normalize_email(value: str) -> str:
    return str(value or "").strip().lower()


def _escape_regex(value: str) -> str:
    return re.escape(str(value or ""))


class TransactionRepository:
    def _col(self):
        return get_db()["transactions"]

    def _users(self):
        return get_db()["users"]

    def resolve_user_email(self, *, user_id, user_email=None) -> str | None:
        normalized = _normalize_email(user_email or "")
        if normalized:
            return normalized
        user = self._users().find_one({"_id": ObjectId(str(user_id))}, {"email": 1})
        return _normalize_email(user.get("email") if user else "") or None

    def build_mongo_filter(self, *, email: str, filters: dict = None, start_date=None, end_date=None) -> dict:
        filters = filters or {}
        direction = filters.get("direction")
        if direction == "outgoing":
            query = {"fromEmail": email}
        elif direction == "incoming":
            query = {"toEmail": email}
        else:
            query = {"$or": [{"fromEmail": email}, {"toEmail": email}]}

        tx_type = filters.get("type")
        if tx_type and tx_type != "transfer":
            query["_id"] = None
            return query

        if start_date or end_date:
            created_at_filter = {}
            if start_date:
                created_at_filter["$gte"] = start_date
            if end_date:
                created_at_filter["$lte"] = end_date
            query["createdAt"] = created_at_filter

        return query

    def count_by_semantic_query(self, *, user_id, user_email=None, filters=None, start_date=None, end_date=None) -> int:
        email = self.resolve_user_email(user_id=user_id, user_email=user_email)
        if not email:
            return 0
        query = self.build_mongo_filter(email=email, filters=filters or {}, start_date=start_date, end_date=end_date)
        return self._col().count_documents(query)

    def list_by_semantic_query(
        self, *, user_id, user_email=None, filters=None, start_date=None, end_date=None, limit=None, sort="desc"
    ) -> list:
        email = self.resolve_user_email(user_id=user_id, user_email=user_email)
        if not email:
            return []
        query = self.build_mongo_filter(email=email, filters=filters or {}, start_date=start_date, end_date=end_date)
        cursor = self._col().find(query).sort("createdAt", ASCENDING if sort == "asc" else DESCENDING)
        if isinstance(limit, int) and limit > 0:
            cursor = cursor.limit(limit)
        return list(cursor)

    def list_counterparty_by_name(
        self, *, user_id, user_email=None, recipient_name: str, limit=10, start_date=None, end_date=None
    ) -> list:
        email = self.resolve_user_email(user_id=user_id, user_email=user_email)
        if not email:
            return []
        normalized = str(recipient_name or "").strip()
        if not normalized:
            return []
        safe = _escape_regex(normalized)
        pattern = re.compile(f"^{safe}@", re.IGNORECASE)
        query: dict = {"$or": [
            {"fromEmail": email, "toEmail": pattern},
            {"fromEmail": pattern, "toEmail": email},
        ]}
        if start_date or end_date:
            created_at: dict = {}
            if start_date:
                created_at["$gte"] = start_date
            if end_date:
                created_at["$lte"] = end_date
            query["createdAt"] = created_at
        safe_limit = min(limit, 100) if isinstance(limit, int) and limit > 0 else 10
        return list(self._col().find(query).sort("createdAt", DESCENDING).limit(safe_limit))

    def find_transactions_with_counterparty_name(self, user_id, recipient_name: str) -> list:
        from models.transaction_model import find_transactions_with_counterparty_name
        return find_transactions_with_counterparty_name(user_id, recipient_name)

    def find_transactions_by_user_id(self, user_id, options: dict = None) -> list:
        from models.transaction_model import find_transactions_by_user_id
        opts = options or {}
        return find_transactions_by_user_id(user_id, limit=opts.get("limit"), offset=opts.get("offset"))

    def execute_transfer(self, *, from_account_id, to_account_id, amount, description=None):
        from models.transaction_model import transfer_money
        return transfer_money(
            from_account_id=from_account_id,
            to_account_id=to_account_id,
            amount=amount,
            description=description,
        )

    def list_recent_by_email(self, *, email: str, limit=5) -> list:
        return list(
            self._col().find(
                {"$or": [{"fromEmail": email}, {"toEmail": email}]}
            ).sort("createdAt", DESCENDING).limit(limit)
        )

    def count_monthly_outgoing_transfers(self, *, email: str, since) -> int:
        return self._col().count_documents({"fromEmail": email, "createdAt": {"$gte": since}})

    def has_beneficiary_history(self, *, sender_email: str, receiver_email: str) -> bool:
        return bool(self._col().find_one({"fromEmail": sender_email, "toEmail": receiver_email}))

    def count_outgoing_since(self, *, email: str, since) -> int:
        return self._col().count_documents({"fromEmail": email, "createdAt": {"$gte": since}})
