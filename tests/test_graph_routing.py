import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from ai.graph.banking_graph import run_banking_graph


def _completion_response(payload: dict):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=json.dumps(payload))
            )
        ]
    )


def _fake_llm(payload_by_message: dict):
    async def create_chat_completion(payload):
        user_payload = json.loads(payload["messages"][-1]["content"])
        current = user_payload["currentUserMessage"]
        return _completion_response(payload_by_message[current])

    return create_chat_completion


class AccountService:
    async def get_balance(self, *, user_id, **_):
        return {"found": True, "balance": 1234.0, "status": "ACTIVE", "currency": "ILS"}


class ProfileService:
    async def get_user_profile(self, *, user_id, **_):
        return {"found": True, "firstName": "Dana", "lastName": "Levi", "email": "dana@example.com"}


class TransactionService:
    pass


def _services():
    return {
        "accountService": AccountService(),
        "profileService": ProfileService(),
        "transactionService": TransactionService(),
    }


def _thread_id(name: str) -> str:
    return f"{name}-{uuid4()}"


@pytest.mark.asyncio
async def test_llm_balance_intent_routes_to_balance_workflow():
    result = await run_banking_graph(
        user_input="מה היתרה שלי",
        user_id="user-1",
        user_email="dana@example.com",
        history=[],
        create_chat_completion=_fake_llm({
            "מה היתרה שלי": {
                "domain": "account",
                "intent": "check_balance",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": None,
            }
        }),
        services=_services(),
        thread_id=_thread_id("balance"),
    )

    assert "יתרה" in result["reply"]
    assert "1234" in result["reply"]


@pytest.mark.asyncio
async def test_llm_profile_intent_routes_to_personal_details_workflow():
    result = await run_banking_graph(
        user_input="מה השם שלי?",
        user_id="user-1",
        user_email="dana@example.com",
        history=[],
        create_chat_completion=_fake_llm({
            "מה השם שלי?": {
                "domain": "profile",
                "intent": "show_personal_details",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": None,
            }
        }),
        services=_services(),
        thread_id=_thread_id("profile"),
    )

    assert "Dana" in result["reply"]
    assert "Levi" in result["reply"]


@pytest.mark.asyncio
async def test_llm_transfer_intent_routes_to_transfer_workflow():
    result = await run_banking_graph(
        user_input="תבצע לי העברה",
        user_id="user-1",
        user_email="dana@example.com",
        history=[],
        create_chat_completion=_fake_llm({
            "תבצע לי העברה": {
                "domain": "transactions",
                "intent": "transfer_money",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": "open_money_transfer_inline",
                "transferPayload": None,
            }
        }),
        services=_services(),
        thread_id=_thread_id("transfer"),
    )

    assert result["nextTransferState"] == {"phase": "form_open"}
    assert result["action"]["type"] == "open_money_transfer_inline"


@pytest.mark.asyncio
async def test_prior_balance_history_does_not_override_current_profile_intent():
    result = await run_banking_graph(
        user_input="מה השם שלי?",
        user_id="user-1",
        user_email="dana@example.com",
        history=[
            {"role": "user", "content": "מה היתרה שלי"},
            {"role": "assistant", "content": "היתרה שלך היא 1234 ILS."},
        ],
        create_chat_completion=_fake_llm({
            "מה השם שלי?": {
                "domain": "profile",
                "intent": "show_personal_details",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": None,
            }
        }),
        services=_services(),
        thread_id=_thread_id("history-profile"),
    )

    assert "Dana" in result["reply"]
    assert "יתרה" not in result["reply"]


@pytest.mark.asyncio
async def test_prior_transactions_history_does_not_override_current_balance_intent():
    result = await run_banking_graph(
        user_input="מה היתרה שלי",
        user_id="user-1",
        user_email="dana@example.com",
        history=[
            {"role": "user", "content": "תראה לי את ההעברות האחרונות"},
            {"role": "assistant", "content": "מצאתי העברות אחרונות."},
        ],
        create_chat_completion=_fake_llm({
            "מה היתרה שלי": {
                "domain": "account",
                "intent": "check_balance",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": None,
            }
        }),
        services=_services(),
        thread_id=_thread_id("history-balance"),
    )

    assert "יתרה" in result["reply"]
    assert "1234" in result["reply"]
