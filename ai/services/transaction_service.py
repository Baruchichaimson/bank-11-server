from datetime import datetime, timezone
from ai.repositories.transaction_repository import TransactionRepository
from ai.services.query_executor import QueryExecutor


def _to_iso(value) -> str | None:
    if not value:
        return None
    try:
        if isinstance(value, datetime):
            return value.isoformat()
        return datetime.fromisoformat(str(value)).isoformat()
    except Exception:
        return None


def _format_transfer(tx: dict) -> dict:
    return {
        "id": tx.get("id"),
        "fromEmail": tx.get("fromEmail"),
        "toEmail": tx.get("toEmail"),
        "amount": float(tx.get("amount") or 0),
        "status": tx.get("status"),
        "description": tx.get("description"),
        "createdAt": _to_iso(tx.get("createdAt")),
    }


def create_transaction_service(*, account_service=None, profile_service=None, transaction_repository=None):
    repo = transaction_repository or TransactionRepository()
    executor = QueryExecutor(
        transaction_repository=repo,
        account_service=account_service,
        profile_service=profile_service,
    )

    class TransactionService:
        async def execute_structured_query(self, *, user_id, user_email=None, query):
            return await executor.execute(user_id=user_id, user_email=user_email, query=query)

        async def get_transactions(self, *, user_id, args=None, operation=None):
            args = args or {}
            if operation == "get_last_sent_transfer_to_recipient":
                return await self._get_transfers_with_counterparty(user_id=user_id, args=args)

            from datetime import date
            now = datetime.now(timezone.utc)

            has_from = isinstance(args.get("from"), str) and args["from"].strip()
            has_to = isinstance(args.get("to"), str) and args["to"].strip()

            from_dt = None
            to_dt = None

            def _parse(v):
                try:
                    return datetime.fromisoformat(v)
                except Exception:
                    return None

            if has_from:
                from_dt = _parse(args["from"])
            if has_to:
                to_dt = _parse(args["to"])

            if (has_from and not from_dt) or (has_to and not to_dt):
                return {"found": False, "message": "Invalid date range format"}

            start = from_dt.replace(hour=0, minute=0, second=0, microsecond=0) if from_dt else datetime(now.year, now.month, 1, tzinfo=timezone.utc)
            end = to_dt.replace(hour=23, minute=59, second=59, microsecond=999000) if to_dt else now

            if start > end:
                return {"found": False, "message": "Invalid date range format"}

            req_limit = float(args.get("limit", 3))
            limit = min(max(int(req_limit), 1), 100) if req_limit == req_limit else 3

            transactions = repo.find_transactions_by_user_id(user_id)
            filtered = [
                tx for tx in transactions
                if start <= (tx.get("createdAt") or datetime.min).replace(tzinfo=timezone.utc if (tx.get("createdAt") or datetime.min).tzinfo is None else None) <= end
            ]

            items = [_format_transfer(tx) for tx in filtered[:limit]]
            return {"found": True, "count": len(items), "from": start.isoformat(), "to": end.isoformat(), "items": items}

        async def _get_transfers_with_counterparty(self, *, user_id, args):
            recipient_name = str(args.get("recipientName") or "").strip()
            if not recipient_name:
                return {"found": False, "message": "recipientName is required"}
            transactions = repo.find_transactions_with_counterparty_name(user_id, recipient_name)
            items = [_format_transfer(tx) for tx in (transactions or [])[:10]]
            if not items:
                return {"found": False, "message": f"No transfers found with recipient {recipient_name}"}
            return {"found": True, "recipientName": recipient_name, "count": len(items), "items": items}

        async def get_last_transfer(self, *, user_id):
            transactions = repo.find_transactions_by_user_id(user_id)
            if not transactions:
                return {"found": False, "message": "No transactions found"}
            return {"found": True, **_format_transfer(transactions[0])}

        async def count_transfers(self, *, user_id, args=None):
            args = args or {}
            from_str = args.get("from", "")
            to_str = args.get("to", "")

            from_dt = None
            to_dt = None

            def _parse(v):
                try:
                    return datetime.fromisoformat(v)
                except Exception:
                    return None

            if from_str:
                from_dt = _parse(from_str)
            if to_str:
                to_dt = _parse(to_str)

            if (from_str and not from_dt) or (to_str and not to_dt):
                return {"found": False, "message": "Invalid date range format"}

            now = datetime.now(timezone.utc)
            start = from_dt.replace(hour=0, minute=0, second=0, microsecond=0) if from_dt else datetime(now.year, now.month, 1, tzinfo=timezone.utc)
            end = to_dt.replace(hour=23, minute=59, second=59) if to_dt else now

            transactions = repo.find_transactions_by_user_id(user_id)

            def _in_range(tx):
                ca = tx.get("createdAt")
                if not ca:
                    return False
                if not ca.tzinfo:
                    ca = ca.replace(tzinfo=timezone.utc)
                return start <= ca <= end

            count = sum(1 for tx in (transactions or []) if _in_range(tx))
            return {"found": True, "count": count, "from": start.isoformat(), "to": end.isoformat()}

        async def get_transfers_with_counterparty(self, *, user_id, args=None):
            return await self._get_transfers_with_counterparty(user_id=user_id, args=args or {})

        async def open_transfer_form(self, **_):
            return {"found": True, "action": {"type": "open_money_transfer_inline"}}

        async def execute_transfer(self, *, from_account_id, to_account_id, amount, description=None):
            return repo.execute_transfer(
                from_account_id=from_account_id,
                to_account_id=to_account_id,
                amount=amount,
                description=description,
            )

        async def get_recent_transactions_by_email(self, *, email, limit=5):
            return repo.list_recent_by_email(email=email, limit=limit)

        async def count_monthly_outgoing_transfers(self, *, email, since):
            return repo.count_monthly_outgoing_transfers(email=email, since=since)

        async def find_transactions_by_user_id(self, user_id, options=None):
            return repo.find_transactions_by_user_id(user_id, options or {})

    return TransactionService()
