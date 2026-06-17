import asyncio
import json
from types import SimpleNamespace

import pytest

from ai.intents.detect_intent import detect_intent
from ai.intents.llm_semantic_parser import parse_query_with_llm


def _completion_response(payload: dict):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=json.dumps(payload))
            )
        ]
    )


@pytest.mark.asyncio
async def test_no_llm_hebrew_balance_text_returns_unknown():
    result = await detect_intent(
        user_input="מה היתרה",
        history=[],
        create_chat_completion=None,
    )

    assert result["domain"] == "unknown"
    assert result["intent"] == "unknown"
    assert result["source"] == "llm_unavailable"


@pytest.mark.asyncio
async def test_llm_balance_response_returns_check_balance():
    async def fake_chat_completion(_payload):
        return _completion_response({
            "domain": "account",
            "intent": "check_balance",
            "confidence": 0.95,
            "semanticQuery": None,
            "toolName": None,
        })

    result = await detect_intent(
        user_input="מה היתרה",
        history=[],
        create_chat_completion=fake_chat_completion,
    )

    assert result["domain"] == "account"
    assert result["intent"] == "check_balance"
    assert result["source"] == "llm_semantic_parser"


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
