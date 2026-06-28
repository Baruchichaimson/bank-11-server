import json
from types import SimpleNamespace

import pytest

from ai.llm.llm_router import invoke_llm_json, invoke_llm_text
from ai.llm.prompt_loader import load_response_prompt


def _completion_response(content):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content)
            )
        ],
    )


@pytest.mark.asyncio
async def test_invoke_llm_text_passes_persona_selected_prompt_to_chat_completion():
    calls = []

    async def fake_chat_completion(payload):
        calls.append(payload)
        return _completion_response("Hello there.")

    result = await invoke_llm_text(
        "assistant_response",
        {"replyContext": {"message": "hello"}},
        persona="formal",
        create_chat_completion=fake_chat_completion,
    )

    assert result == "Hello there."
    assert calls[0]["operation"] == "assistant_response"
    assert calls[0]["prompt_file"] == "prompts/response/formal.md"
    assert calls[0]["messages"][0]["content"].startswith("You are a professional banking assistant.")
    assert calls[0]["metadata"]["persona"] == "formal"
    assert calls[0]["metadata"]["prompt_source"] == "local"
    assert calls[0]["metadata"]["prompt_override_used"] is False


@pytest.mark.asyncio
async def test_json_operations_remain_json_only_and_ignore_response_persona_prompts():
    calls = []

    async def fake_chat_completion(payload):
        calls.append(payload)
        return _completion_response(json.dumps({"level": "LOW", "reason": "ok"}))

    result = await invoke_llm_json(
        "risk_analysis",
        {"operation": "risk_analysis", "persona": "young", "amount": 100},
        create_chat_completion=fake_chat_completion,
    )

    assert result["level"] == "LOW"
    assert calls[0]["operation"] == "risk_analysis"
    assert calls[0]["prompt_file"] == "prompts/risk_analysis.md"
    assert "banking transfer risk analysis model" in calls[0]["messages"][0]["content"]
    assert "friendly banking assistant" not in calls[0]["messages"][0]["content"]
    assert "persona" not in (calls[0].get("metadata") or {})


def test_response_prompt_files_load():
    default_prompt = load_response_prompt("default")[0]
    young_prompt = load_response_prompt("young")[0]
    formal_prompt = load_response_prompt("formal")[0]

    assert "banking assistant" in default_prompt
    assert "younger audience" in young_prompt
    assert "professional banking assistant" in formal_prompt
