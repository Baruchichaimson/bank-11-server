from ai.services.time_range_normalizer import normalize_time_range

DEFAULT_TRANSACTION_LIST_LIMIT = 10
DEFAULT_FIRST_N_LIMIT = 1
MAX_TRANSACTION_LIST_LIMIT = 100


def _normalize_list_limit(value, fallback: int) -> int:
    if not isinstance(value, int) or value <= 0:
        return fallback
    return min(value, MAX_TRANSACTION_LIST_LIMIT)


def _normalize_sort_direction(value, fallback="desc") -> str:
    return value if value in ("asc", "desc") else fallback


def _build_result_meta(*, start_date=None, end_date=None, limit=None, sort_direction=None) -> dict:
    from_iso = start_date.isoformat() if start_date else None
    to_iso = end_date.isoformat() if end_date else None
    return {
        "from": from_iso,
        "to": to_iso,
        "hasDateRange": bool(start_date or end_date),
        "requestedLimit": limit,
        "sortDirection": sort_direction,
    }


class QueryExecutor:
    def __init__(self, *, transaction_repository=None, account_service=None, profile_service=None):
        self.transaction_repository = transaction_repository
        self.account_service = account_service
        self.profile_service = profile_service

    async def execute(self, *, user_id, user_email=None, query: dict) -> dict:
        if not query or not query.get("domain") or not query.get("intent"):
            raise ValueError("Invalid structured query payload")

        if query["domain"] == "transactions" and query["intent"] == "transactions_query":
            return await self._execute_transactions_query(user_id=user_id, user_email=user_email, query=query)

        if query["domain"] == "account" and query["intent"] == "get_balance":
            result = await self.account_service.get_balance(user_id=user_id)
            return {"operation": "get_balance", "result": result}

        if query["domain"] == "profile" and query["intent"] == "get_user_name":
            result = await self.profile_service.get_identity(user_id=user_id)
            return {"operation": "get_user_identity", "result": result}

        raise ValueError(f"Unsupported domain/intent: {query['domain']}/{query['intent']}")

    async def _execute_transactions_query(self, *, user_id, user_email=None, query: dict) -> dict:
        if not self.transaction_repository:
            raise ValueError("transaction_repository is required for transactions_query")

        try:
            normalized_range = normalize_time_range(date_range=query.get("dateRange"))
        except Exception:
            return {"operation": "get_recent_transfers", "result": {"found": False, "message": "Invalid date range"}}

        start_date = normalized_range["startDate"]
        end_date = normalized_range["endDate"]
        base_args = dict(
            user_id=user_id,
            user_email=user_email,
            filters=query.get("filters") or {},
            start_date=start_date,
            end_date=end_date,
        )

        aggregation = query.get("aggregation")

        if aggregation == "counterparty":
            recipient_name = str(query.get("recipientName") or "").strip()
            if not recipient_name:
                return {"operation": "get_last_sent_transfer_to_recipient", "result": {"found": False, "message": "recipientName is required"}}
            limit = query.get("limit") if isinstance(query.get("limit"), int) and query["limit"] > 0 else 10
            items = self.transaction_repository.list_counterparty_by_name(
                user_id=user_id, user_email=user_email, recipient_name=recipient_name,
                limit=limit, start_date=start_date, end_date=end_date
            )
            return {
                "operation": "get_last_sent_transfer_to_recipient",
                "result": {
                    "found": True,
                    "recipientName": recipient_name,
                    "count": len(items),
                    "items": items,
                    **_build_result_meta(start_date=start_date, end_date=end_date, limit=limit, sort_direction="desc"),
                },
            }

        if aggregation == "count":
            count = self.transaction_repository.count_by_semantic_query(**base_args)
            return {
                "operation": "count_transfers",
                "result": {"found": True, "count": count, **_build_result_meta(start_date=start_date, end_date=end_date)},
            }

        if aggregation == "first_n":
            limit = _normalize_list_limit(query.get("limit"), DEFAULT_FIRST_N_LIMIT)
            sort = _normalize_sort_direction(query.get("sortDirection"), "desc")
            items = self.transaction_repository.list_by_semantic_query(**base_args, limit=limit, sort=sort)
            return {
                "operation": "get_first_n_transfers",
                "result": {
                    "found": True,
                    "count": len(items),
                    "items": items,
                    **_build_result_meta(start_date=start_date, end_date=end_date, limit=limit, sort_direction=sort),
                },
            }

        if aggregation in ("list", None, ""):
            limit = _normalize_list_limit(query.get("limit"), DEFAULT_TRANSACTION_LIST_LIMIT)
            sort = _normalize_sort_direction(query.get("sortDirection"), "desc")
            items = self.transaction_repository.list_by_semantic_query(**base_args, limit=limit, sort=sort)
            return {
                "operation": "get_recent_transfers",
                "result": {
                    "found": True,
                    "count": len(items),
                    "items": items,
                    **_build_result_meta(start_date=start_date, end_date=end_date, limit=limit, sort_direction=sort),
                },
            }

        raise ValueError(f"Unsupported aggregation: {aggregation}")
