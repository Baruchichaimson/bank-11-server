import json
from types import SimpleNamespace

import pytest

from ai.llm.errors import LLMResponseError, PromptLoadError, UnknownOperationError
from ai.llm.llm_router import invoke_llm_json, load_llm_routing_config, resolve_operation_config
from ai.llm.prompt_loader import load_prompt


def _completion_response(content):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content)
            )
        ],
    )


def test_llm_routing_config_loads_successfully():
    config = load_llm_routing_config()

    assert "operations" in config
    assert "user_intent" in config["operations"]
    assert "risk_analysis" in config["operations"]
    assert "risk_judge" in config["operations"]


def test_known_operation_resolves_runtime_settings():
    settings = resolve_operation_config("user_intent")

    assert settings["operation"] == "user_intent"
    assert settings["provider"] == "openai"
    assert settings["model"] == "gpt-4o-mini"
    assert settings["response_format"] == {"type": "json_object"}
    assert settings["prompt_file"] == "prompts/user_intent.md"


def test_unknown_operation_raises_clear_error():
    with pytest.raises(UnknownOperationError, match="Unknown LLM operation"):
        resolve_operation_config("does_not_exist")


def test_prompt_file_loads_correctly():
    prompt = load_prompt("prompts/user_intent.md")

    assert "Return JSON only" in prompt
    assert "currentUserMessage is authoritative" in prompt
    assert "transfer_money" in prompt


def test_missing_prompt_raises_clear_error():
    with pytest.raises(PromptLoadError, match="Prompt file not found"):
        load_prompt("prompts/missing_prompt.md")


@pytest.mark.asyncio
async def test_invoke_llm_json_uses_injected_chat_completion_and_parses_json():
    calls = []

    async def fake_chat_completion(payload):
        calls.append(payload)
        return _completion_response(json.dumps({"level": "LOW", "reason": "ok"}))

    result = await invoke_llm_json(
        "risk_analysis",
        {"operation": "risk_analysis", "amount": 100},
        create_chat_completion=fake_chat_completion,
    )

    assert result["level"] == "LOW"
    assert result["reason"] == "ok"
    assert result["provider"] == "openai"
    assert result["model"] == "gpt-4o-mini"
    assert len(calls) == 1
    assert calls[0]["operation"] == "risk_analysis"
    assert calls[0]["provider"] == "openai"
    assert calls[0]["model"] == "gpt-4o-mini"
    assert calls[0]["response_format"] == {"type": "json_object"}
    assert calls[0]["prompt_file"] == "prompts/risk_analysis.md"
    assert calls[0]["messages"][0]["role"] == "system"
    assert json.loads(calls[0]["messages"][-1]["content"])["amount"] == 100


@pytest.mark.asyncio
async def test_invoke_llm_json_user_intent_routes_through_configured_prompt():
    calls = []

    async def fake_chat_completion(payload):
        calls.append(payload)
        return _completion_response(
            json.dumps(
                {
                    "domain": "account",
                    "intent": "check_balance",
                    "confidence": 0.98,
                    "isAmbiguous": False,
                    "ambiguityReason": None,
                    "toolName": None,
                    "semanticQuery": None,
                    "transferPayload": None,
                }
            )
        )

    result = await invoke_llm_json(
        "user_intent",
        {"currentUserMessage": "מה היתרה שלי?", "recentConversation": []},
        create_chat_completion=fake_chat_completion,
    )

    assert result["domain"] == "account"
    assert result["intent"] == "check_balance"
    assert calls[0]["operation"] == "user_intent"
    assert calls[0]["prompt_file"] == "prompts/user_intent.md"
    assert calls[0]["messages"][0]["content"].startswith("You are a banking intent router")


@pytest.mark.asyncio
async def test_invoke_llm_json_malformed_response_raises_clear_error():
    async def fake_chat_completion(_payload):
        return _completion_response("not-json")

    with pytest.raises(LLMResponseError, match="malformed JSON"):
        await invoke_llm_json(
            "risk_analysis",
            {"operation": "risk_analysis"},
            create_chat_completion=fake_chat_completion,
        )
