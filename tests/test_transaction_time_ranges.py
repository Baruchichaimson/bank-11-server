from datetime import datetime, timezone

import pytest

from ai.intents.llm_semantic_parser import validate_llm_semantic_parse
from ai.repositories.transaction_repository import TransactionRepository
from ai.services.query_executor import QueryExecutor
from ai.services.time_range_normalizer import normalize_time_range


def test_llm_validation_preserves_supported_time_range():
    result = validate_llm_semantic_parse({
        "domain": "transactions",
        "intent": "recent_transactions",
        "confidence": 0.95,
        "isAmbiguous": False,
        "ambiguityReason": None,
        "toolName": None,
        "semanticQuery": {
            "domain": "transactions",
            "intent": "transactions_query",
            "action": "transfer_money",
            "filters": {"type": "transfer", "direction": "outgoing"},
            "timeRange": "this_month",
            "dateRange": None,
            "aggregation": "count",
            "limit": None,
            "sortDirection": "desc",
        },
        "transferPayload": None,
    })

    assert result["semanticQuery"]["timeRange"] == "this_month"


def test_this_month_uses_project_timezone_and_utc_query_bounds():
    result = normalize_time_range(
        time_range="this_month",
        now=datetime(2026, 6, 18, 12, 0, tzinfo=timezone.utc),
    )

    assert result["label"] == "this_month"
    assert result["startDate"] == datetime(2026, 5, 31, 21, 0, tzinfo=timezone.utc)
    assert result["endDate"] == datetime(2026, 6, 30, 21, 0, tzinfo=timezone.utc)
    assert result["displayStartDate"].isoformat() == "2026-06-01T00:00:00+03:00"
    assert result["displayEndDate"].isoformat() == "2026-06-30T23:59:59.999999+03:00"


def test_last_month_uses_previous_calendar_month():
    result = normalize_time_range(
        time_range="last_month",
        now=datetime(2026, 6, 18, 12, 0, tzinfo=timezone.utc),
    )

    assert result["label"] == "last_month"
    assert result["startDate"] == datetime(2026, 4, 30, 21, 0, tzinfo=timezone.utc)
    assert result["endDate"] == datetime(2026, 5, 31, 21, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    ("time_range", "expected_start", "expected_end"),
    [
        (
            "today",
            datetime(2026, 6, 17, 21, 0, tzinfo=timezone.utc),
            datetime(2026, 6, 18, 21, 0, tzinfo=timezone.utc),
        ),
        (
            "this_week",
            datetime(2026, 6, 13, 21, 0, tzinfo=timezone.utc),
            datetime(2026, 6, 20, 21, 0, tzinfo=timezone.utc),
        ),
    ],
)
def test_day_and_week_ranges_use_project_timezone(time_range, expected_start, expected_end):
    result = normalize_time_range(
        time_range=time_range,
        now=datetime(2026, 6, 18, 12, 0, tzinfo=timezone.utc),
    )

    assert result["label"] == time_range
    assert result["startDate"] == expected_start
    assert result["endDate"] == expected_end


def test_explicit_date_range_takes_precedence_over_time_range():
    result = normalize_time_range(
        time_range="this_month",
        date_range={"from": "2026-04-10", "to": "2026-04-12"},
        now=datetime(2026, 6, 18, 12, 0, tzinfo=timezone.utc),
    )

    assert result["label"] == "date_range"
    assert result["displayStartDate"].isoformat() == "2026-04-10T00:00:00+03:00"
    assert result["displayEndDate"].isoformat() == "2026-04-12T23:59:59.999999+03:00"


def test_repository_filter_uses_exclusive_created_at_end_bound():
    start = datetime(2026, 5, 31, 21, 0, tzinfo=timezone.utc)
    end = datetime(2026, 6, 30, 21, 0, tzinfo=timezone.utc)

    query = TransactionRepository().build_mongo_filter(
        email="user@example.com",
        filters={"type": "transfer", "direction": "outgoing"},
        start_date=start,
        end_date=end,
    )

    assert query == {
        "fromEmail": "user@example.com",
        "createdAt": {"$gte": start, "$lt": end},
    }


@pytest.mark.asyncio
async def test_count_query_passes_time_range_bounds_to_count_documents(monkeypatch):
    captured_normalizer_args = {}
    start = datetime(2026, 5, 31, 21, 0, tzinfo=timezone.utc)
    end = datetime(2026, 6, 30, 21, 0, tzinfo=timezone.utc)

    def fake_normalize_time_range(*, time_range=None, date_range=None):
        captured_normalizer_args.update({"time_range": time_range, "date_range": date_range})
        return {
            "startDate": start,
            "endDate": end,
            "displayStartDate": start,
            "displayEndDate": end,
            "label": time_range,
        }

    monkeypatch.setattr("ai.services.query_executor.normalize_time_range", fake_normalize_time_range)

    class CapturingRepo:
        def __init__(self):
            self.count_kwargs = None

        def count_by_semantic_query(self, **kwargs):
            self.count_kwargs = kwargs
            return 3

    repo = CapturingRepo()
    result = await QueryExecutor(transaction_repository=repo).execute(
        user_id="user-id",
        user_email="user@example.com",
        query={
            "domain": "transactions",
            "intent": "transactions_query",
            "filters": {"type": "transfer", "direction": "outgoing"},
            "timeRange": "this_month",
            "dateRange": None,
            "aggregation": "count",
        },
    )

    assert captured_normalizer_args == {"time_range": "this_month", "date_range": None}
    assert repo.count_kwargs["start_date"] == start
    assert repo.count_kwargs["end_date"] == end
    assert repo.count_kwargs["filters"] == {"type": "transfer", "direction": "outgoing"}
    assert result["operation"] == "count_transfers"
    assert result["result"]["count"] == 3
