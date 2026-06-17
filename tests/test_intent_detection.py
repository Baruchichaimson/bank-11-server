import asyncio
import json
from types import SimpleNamespace

import pytest

from ai.intents.detect_intent import detect_intent
from ai.intents.llm_semantic_parser import build_semantic_parser_prompt, parse_query_with_llm


def _completion_response(payload: dict):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=json.dumps(payload))
            )
        ]
    )


def _balance_payload(confidence=0.98):
    return {
        "domain": "account",
        "intent": "check_balance",
        "confidence": confidence,
        "isAmbiguous": False,
        "ambiguityReason": None,
        "semanticQuery": None,
        "transferPayload": None,
        "toolName": None,
    }


def _profile_payload():
    return {
        "domain": "profile",
        "intent": "show_personal_details",
        "confidence": 0.98,
        "isAmbiguous": False,
        "ambiguityReason": None,
        "semanticQuery": None,
        "transferPayload": None,
        "toolName": None,
    }


def _transfer_payload():
    return {
        "domain": "transactions",
        "intent": "transfer_money",
        "confidence": 0.98,
        "isAmbiguous": False,
        "ambiguityReason": None,
        "toolName": "open_money_transfer_inline",
        "semanticQuery": None,
        "transferPayload": {
            "receiverEmail": None,
            "amount": None,
            "description": None,
            "confirmation": None,
            "skipDescription": False,
            "startNewTransfer": True,
        },
    }


def _recent_transfers_payload():
    return {
        "domain": "transactions",
        "intent": "recent_transactions",
        "confidence": 0.95,
        "isAmbiguous": False,
        "ambiguityReason": None,
        "semanticQuery": {
            "domain": "transactions",
            "intent": "transactions_query",
            "action": "transfer_money",
            "filters": {"type": "transfer"},
            "timeRange": None,
            "aggregation": "list",
            "limit": None,
            "sortDirection": "desc",
        },
        "transferPayload": None,
        "toolName": None,
    }


def _user_prompt_payload(chat_completion_payload: dict) -> dict:
    content = chat_completion_payload["messages"][-1]["content"]
    return json.loads(content)


def test_semantic_parser_prompt_prioritizes_standalone_balance_messages():
    prompt = build_semantic_parser_prompt()

    assert "currentUserMessage is authoritative" in prompt
    assert "Response contract:" not in prompt
    assert "Semantic intent contract:" not in prompt
    assert 'User: "מה השם שלי?"' in prompt
    assert 'User: "איך קוראים לי?"' in prompt
    assert 'User: "תבצע לי העברה"' in prompt
    assert 'User: "אני רוצה להעביר כסף"' in prompt
    assert '"domain":"profile","intent":"show_personal_details"' in prompt
    assert '"domain":"transactions","intent":"transfer_money"' in prompt
    assert '"toolName":"open_money_transfer_inline"' in prompt
    assert '"מה השם שלי" is never account/check_balance' in prompt
    assert '"תבצע לי העברה" is not balance' in prompt
    assert len(prompt) < 7000


@pytest.mark.asyncio
async def test_no_llm_hebrew_balance_text_returns_unknown():
    result = await detect_intent(
        user_input="מה היתרה שלי?",
        history=[],
        create_chat_completion=None,
    )

    assert result["domain"] == "unknown"
    assert result["intent"] == "unknown"
    assert result["source"] == "llm_unavailable"


@pytest.mark.asyncio
async def test_llm_balance_response_returns_check_balance():
    async def fake_chat_completion(_payload):
        return _completion_response(_balance_payload(confidence=0.95))

    result = await detect_intent(
        user_input="מה היתרה שלי?",
        history=[],
        create_chat_completion=fake_chat_completion,
    )

    assert result["domain"] == "account"
    assert result["intent"] == "check_balance"
    assert result["source"] == "llm_semantic_parser"


@pytest.mark.asyncio
async def test_llm_hebrew_money_in_account_returns_check_balance():
    async def fake_chat_completion(payload):
        user_payload = _user_prompt_payload(payload)
        assert user_payload["currentUserMessage"] == "כמה כסף יש לי בחשבון?"
        assert "currentUserMessage overrides recentConversation" in user_payload["routingInstruction"]
        return _completion_response(_balance_payload())

    result = await detect_intent(
        user_input="כמה כסף יש לי בחשבון?",
        history=[],
        create_chat_completion=fake_chat_completion,
    )

    assert result["domain"] == "account"
    assert result["intent"] == "check_balance"


@pytest.mark.asyncio
async def test_current_balance_message_overrides_transaction_history_context():
    history = [
        {"role": "user", "content": "תראה לי את ההעברות האחרונות"},
        {"role": "assistant", "content": "מצאתי עבורך העברות אחרונות."},
        {"role": "user", "content": "מה ההעברה האחרונה שביצעתי?"},
        {"role": "assistant", "content": "ההעברה האחרונה הייתה אתמול."},
    ]

    async def fake_chat_completion(payload):
        user_payload = _user_prompt_payload(payload)
        assert user_payload["currentUserMessage"] == "מה היתרה שלי?"
        assert len(user_payload["recentConversation"]) == 2
        assert any("העברה" in item["content"] for item in user_payload["recentConversation"])
        return _completion_response(_balance_payload())

    result = await detect_intent(
        user_input="מה היתרה שלי?",
        history=history,
        create_chat_completion=fake_chat_completion,
    )

    assert result["domain"] == "account"
    assert result["intent"] == "check_balance"


@pytest.mark.asyncio
@pytest.mark.parametrize("message", ["מה השם שלי", "מה השם שלי?", "איך קוראים לי"])
async def test_profile_questions_return_profile_intent(message):
    async def fake_chat_completion(payload):
        user_payload = _user_prompt_payload(payload)
        assert user_payload["currentUserMessage"] == message
        return _completion_response(_profile_payload())

    result = await detect_intent(
        user_input=message,
        history=[],
        create_chat_completion=fake_chat_completion,
    )

    assert result["domain"] == "profile"
    assert result["intent"] == "show_personal_details"


@pytest.mark.asyncio
@pytest.mark.parametrize("message", ["תבצע לי העברה", "אני רוצה להעביר כסף"])
async def test_transfer_start_questions_return_transfer_money_intent(message):
    async def fake_chat_completion(payload):
        user_payload = _user_prompt_payload(payload)
        assert user_payload["currentUserMessage"] == message
        return _completion_response(_transfer_payload())

    result = await detect_intent(
        user_input=message,
        history=[],
        create_chat_completion=fake_chat_completion,
    )

    assert result["domain"] == "transactions"
    assert result["intent"] == "transfer_money"
    assert result["tool"]["name"] == "open_money_transfer_inline"
    assert result["transferPayload"]["startNewTransfer"] is True


@pytest.mark.asyncio
async def test_balance_history_does_not_override_current_profile_intent():
    history = [
        {"role": "user", "content": "מה היתרה שלי"},
        {"role": "assistant", "content": "היתרה שלך היא 1234 ILS."},
    ]

    async def fake_chat_completion(payload):
        user_payload = _user_prompt_payload(payload)
        assert user_payload["currentUserMessage"] == "מה השם שלי"
        assert any("יתרה" in item["content"] for item in user_payload["recentConversation"])
        return _completion_response(_profile_payload())

    result = await detect_intent(
        user_input="מה השם שלי",
        history=history,
        create_chat_completion=fake_chat_completion,
    )

    assert result["domain"] == "profile"
    assert result["intent"] == "show_personal_details"


@pytest.mark.asyncio
async def test_balance_history_does_not_override_current_transfer_intent():
    history = [
        {"role": "user", "content": "מה היתרה שלי"},
        {"role": "assistant", "content": "היתרה שלך היא 1234 ILS."},
    ]

    async def fake_chat_completion(payload):
        user_payload = _user_prompt_payload(payload)
        assert user_payload["currentUserMessage"] == "תבצע לי העברה"
        assert any("יתרה" in item["content"] for item in user_payload["recentConversation"])
        return _completion_response(_transfer_payload())

    result = await detect_intent(
        user_input="תבצע לי העברה",
        history=history,
        create_chat_completion=fake_chat_completion,
    )

    assert result["domain"] == "transactions"
    assert result["intent"] == "transfer_money"
    assert result["transferPayload"]["startNewTransfer"] is True


@pytest.mark.asyncio
async def test_llm_hebrew_recent_transfers_still_returns_recent_transactions():
    async def fake_chat_completion(payload):
        user_payload = _user_prompt_payload(payload)
        assert user_payload["currentUserMessage"] == "תראה לי את ההעברות האחרונות"
        return _completion_response(_recent_transfers_payload())

    result = await detect_intent(
        user_input="תראה לי את ההעברות האחרונות",
        history=[],
        create_chat_completion=fake_chat_completion,
    )

    assert result["domain"] == "transactions"
    assert result["intent"] == "recent_transactions"
    assert result["semanticQuery"]["aggregation"] == "list"
    assert result["semanticQuery"]["filters"]["type"] == "transfer"


@pytest.mark.asyncio
async def test_parser_reraises_cancelled_error():
    async def canceled_chat_completion(_payload):
        raise asyncio.CancelledError()

    with pytest.raises(asyncio.CancelledError):
        await parse_query_with_llm(
            user_input="balance",
            history=[],
            create_chat_completion=canceled_chat_completion,
        )
