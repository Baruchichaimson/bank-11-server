from datetime import datetime, timezone
from decimal import Decimal

import ormsgpack
import pytest
from bson import ObjectId

from ai.contracts.assistant_response_contract import create_executed_workflow_response
from ai.graph.banking_graph import run_transactions_workflow_node
from ai.shared.json_safe import make_json_safe


def test_make_json_safe_converts_bson_and_datetime_values():
    object_id = ObjectId()
    timestamp = datetime(2026, 6, 17, 12, 30, tzinfo=timezone.utc)

    result = make_json_safe({
        "_id": object_id,
        "createdAt": timestamp,
        "amount": Decimal("12.50"),
        "nested": [{"ownerId": object_id}],
    })

    assert result == {
        "_id": str(object_id),
        "createdAt": timestamp.isoformat(),
        "amount": 12.5,
        "nested": [{"ownerId": str(object_id)}],
    }
    ormsgpack.packb(result)


def test_workflow_response_execution_result_is_msgpack_safe():
    object_id = ObjectId()
    response = create_executed_workflow_response(
        operation="transfer_money",
        result={"transaction": {"_id": object_id}},
    )

    assert response["execution"]["result"]["transaction"]["_id"] == str(object_id)
    ormsgpack.packb(response)


@pytest.mark.asyncio
async def test_transactions_workflow_node_returns_msgpack_safe_state():
    object_id = ObjectId()
    timestamp = datetime(2026, 6, 17, 12, 30, tzinfo=timezone.utc)

    class TransactionService:
        async def execute_structured_query(self, **_kwargs):
            return {
                "operation": "get_recent_transfers",
                "result": {
                    "found": True,
                    "count": 1,
                    "items": [{
                        "_id": object_id,
                        "fromEmail": "sender@example.com",
                        "toEmail": "receiver@example.com",
                        "amount": 42,
                        "createdAt": timestamp,
                    }],
                },
            }

    state = {
        "session": {"userId": str(ObjectId()), "userEmail": "sender@example.com", "userLanguage": "en"},
        "intent": {
            "semanticQuery": {
                "filters": {"type": "transfer"},
                "dateRange": None,
                "action": "transfer_money",
            },
        },
        "workflow": {},
        "transactions": {},
        "ui": {},
    }

    result = await run_transactions_workflow_node(
        state,
        config={"configurable": {"services": {"transactionService": TransactionService()}}},
    )

    item = result["workflowResponse"]["execution"]["result"]["items"][0]
    assert item["_id"] == str(object_id)
    assert item["createdAt"] == timestamp.isoformat()
    ormsgpack.packb(result)
