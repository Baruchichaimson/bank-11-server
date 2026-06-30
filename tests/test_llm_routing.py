import json
import sys
from types import SimpleNamespace

import pytest

from ai.assistant import chat_assistant
from ai.llm.errors import LLMResponseError, PromptLoadError, UnknownOperationError
from ai.llm.llm_router import invoke_llm_json, load_llm_routing_config, resolve_operation_config
from ai.llm.prompt_loader import load_prompt
from ai.llm import provider_clients


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
    assert settings["provider"] == "groq"
    assert settings["model"] == "llama-3.1-8b-instant"
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
    assert result["provider"] == "groq"
    assert result["model"] == "llama-3.1-8b-instant"
    assert len(calls) == 1
    assert calls[0]["operation"] == "risk_analysis"
    assert calls[0]["provider"] == "groq"
    assert calls[0]["model"] == "llama-3.1-8b-instant"
    assert calls[0]["response_format"] == {"type": "json_object"}
    assert calls[0]["prompt_file"] == "prompts/risk_analysis.md"
    assert calls[0]["metadata"]["operation"] == "risk_analysis"
    assert calls[0]["metadata"]["prompt_source"] == "local"
    assert calls[0]["metadata"]["config_source"] == "local"
    assert calls[0]["metadata"]["prompt_override_used"] is False
    assert calls[0]["metadata"]["response_format_type"] == "json_object"
    assert calls[0]["metadata"]["cost_tier"] == "low"
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
    assert calls[0]["metadata"]["prompt_source"] == "local"
    assert calls[0]["metadata"]["config_source"] == "local"
    assert calls[0]["metadata"]["prompt_override_used"] is False
    assert calls[0]["metadata"]["response_format_type"] == "json_object"
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


@pytest.mark.asyncio
async def test_create_chat_completion_filters_internal_fields_before_sdk_call(monkeypatch):
    captured = {}

    class FakeCompletions:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return _completion_response(json.dumps({"ok": True}))

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=FakeCompletions())
    )

    monkeypatch.setattr(chat_assistant, "openai_client", fake_client)
    monkeypatch.setattr(chat_assistant, "OPENAI_MODEL", "fallback-model")
    monkeypatch.setattr(chat_assistant, "IS_LANGFUSE_OPENAI_CLIENT", False)

    await chat_assistant._create_chat_completion({
        "operation": "user_intent",
        "provider": "openai",
        "model": "gpt-4o-mini",
        "prompt_file": "prompts/user_intent.md",
        "cost_tier": "low",
        "langfuse_name": "llm.user_intent",
        "metadata": {"operation": "user_intent"},
        "abortSignal": object(),
        "messages": [{"role": "user", "content": "hello"}],
        "temperature": 0,
    })

    assert captured["model"] == "gpt-4o-mini"
    assert captured["messages"] == [{"role": "user", "content": "hello"}]
    assert captured["temperature"] == 0
    for field in (
        "operation",
        "provider",
        "prompt_file",
        "cost_tier",
        "langfuse_name",
        "metadata",
        "abortSignal",
    ):
        assert field not in captured


@pytest.mark.asyncio
async def test_invoke_provider_chat_completion_filters_operation_and_langfuse_name_before_sdk_call(monkeypatch):
    captured = {}

    class FakeCompletions:
        async def create(self, **kwargs):
            captured.update(kwargs)
            return _completion_response(json.dumps({"ok": True}))

    class FakeAsyncOpenAI:
        def __init__(self, **kwargs):
            self.client_kwargs = kwargs
            self.chat = SimpleNamespace(completions=FakeCompletions())

    fake_langfuse_openai = SimpleNamespace(AsyncOpenAI=FakeAsyncOpenAI)
    monkeypatch.setitem(sys.modules, "langfuse.openai", fake_langfuse_openai)
    monkeypatch.setattr(provider_clients, "_provider_credentials", lambda _provider: {"api_key": "test-key", "base_url": None})
    monkeypatch.setattr(provider_clients, "get_langfuse_openai_kwargs", lambda **_kwargs: {})

    await provider_clients.invoke_provider_chat_completion({
        "operation": "risk_analysis",
        "provider": "openai",
        "model": "gpt-4o-mini",
        "prompt_file": "prompts/risk_analysis.md",
        "cost_tier": "low",
        "langfuse_name": "llm.risk_analysis",
        "metadata": {"operation": "risk_analysis"},
        "abortSignal": object(),
        "messages": [{"role": "user", "content": "hello"}],
        "temperature": 0,
    })

    assert captured["model"] == "gpt-4o-mini"
    assert captured["messages"] == [{"role": "user", "content": "hello"}]
    assert captured["temperature"] == 0
    for field in (
        "operation",
        "provider",
        "prompt_file",
        "cost_tier",
        "langfuse_name",
        "metadata",
        "abortSignal",
    ):
        assert field not in captured
