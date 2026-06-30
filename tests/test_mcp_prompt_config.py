import json
from types import SimpleNamespace

import pytest

from ai.llm.errors import LLMRoutingError, PromptLoadError
from ai.llm import llm_router, prompt_loader
from ai.llm.llm_router import aload_llm_routing_config, invoke_llm_json
from ai.llm.prompt_loader import aload_prompt, load_prompt
from ai.mcp import mcp_client
from config import settings


def _completion_response(content):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content)
            )
        ],
    )


@pytest.mark.asyncio
async def test_mcp_disabled_local_config_works(monkeypatch):
    monkeypatch.setattr(settings, "MCP_ENABLED", False)

    config, source, meta = await aload_llm_routing_config()

    assert source == "local"
    assert meta == {}
    assert "user_intent" in config["operations"]


def test_mcp_disabled_local_prompt_works(monkeypatch):
    monkeypatch.setattr(settings, "MCP_ENABLED", False)

    prompt = load_prompt("prompts/user_intent.md")

    assert "Return JSON only" in prompt


@pytest.mark.asyncio
async def test_mocked_mcp_config_response_uses_mcp_source(monkeypatch):
    remote_config = {
        "operations": {
            "user_intent": {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "prompt_file": "prompts/user_intent.md",
            }
        }
    }

    async def fake_fetch():
        return remote_config

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(llm_router, "fetch_llm_routing_config", fake_fetch)

    config, source, meta = await aload_llm_routing_config()

    assert source == "mcp"
    assert meta == {}
    assert config["operations"]["user_intent"]["provider"] == "openai"


@pytest.mark.asyncio
async def test_mocked_mcp_prompt_response_uses_mcp_source(monkeypatch):
    async def fake_fetch(_name):
        return "MCP prompt body"

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(prompt_loader, "fetch_prompt", fake_fetch)

    prompt, details = await aload_prompt("prompts/user_intent.md")

    assert prompt == "MCP prompt body"
    assert details["prompt_source"] == "mcp"
    assert details["prompt_file"] == "prompts/user_intent.md"


@pytest.mark.asyncio
async def test_mcp_unavailable_falls_back_to_local_config(monkeypatch):
    async def fake_fetch():
        raise mcp_client.MCPFetchError("connection refused")

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(settings, "MCP_FALLBACK_TO_LOCAL", True)
    monkeypatch.setattr(llm_router, "fetch_llm_routing_config", fake_fetch)

    config, source, meta = await aload_llm_routing_config()

    assert source == "local"
    assert meta["mcp_fallback"] is True
    assert "connection refused" in meta["mcp_error"]
    assert "user_intent" in config["operations"]


@pytest.mark.asyncio
async def test_mcp_unavailable_falls_back_to_local_prompt(monkeypatch):
    async def fake_fetch(_name):
        raise mcp_client.MCPFetchError("timeout")

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(settings, "MCP_FALLBACK_TO_LOCAL", True)
    monkeypatch.setattr(prompt_loader, "fetch_prompt", fake_fetch)

    prompt, details = await aload_prompt("prompts/user_intent.md")

    assert "Return JSON only" in prompt
    assert details["prompt_source"] == "local"
    assert details["mcp_fallback"] is True
    assert "timeout" in details["mcp_error"]


@pytest.mark.asyncio
async def test_mcp_unavailable_without_fallback_raises_for_config(monkeypatch):
    async def fake_fetch():
        raise mcp_client.MCPFetchError("down")

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(settings, "MCP_FALLBACK_TO_LOCAL", False)
    monkeypatch.setattr(llm_router, "fetch_llm_routing_config", fake_fetch)

    with pytest.raises(LLMRoutingError, match="fallback is disabled"):
        await aload_llm_routing_config()


@pytest.mark.asyncio
async def test_mcp_unavailable_without_fallback_raises_for_prompt(monkeypatch):
    async def fake_fetch(_name):
        raise mcp_client.MCPFetchError("down")

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(settings, "MCP_FALLBACK_TO_LOCAL", False)
    monkeypatch.setattr(prompt_loader, "fetch_prompt", fake_fetch)

    with pytest.raises(PromptLoadError, match="fallback is disabled"):
        await aload_prompt("prompts/user_intent.md")


@pytest.mark.asyncio
async def test_invoke_llm_json_records_mcp_sources_in_metadata(monkeypatch):
    remote_config = {
        "operations": {
            "risk_analysis": {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "temperature": 0,
                "max_tokens": 900,
                "response_format": {"type": "json_object"},
                "prompt_file": "prompts/risk_analysis.md",
                "cost_tier": "low",
            }
        }
    }
    calls = []

    async def fake_fetch_config():
        return remote_config

    async def fake_fetch_prompt(_name):
        return "MCP risk analysis prompt"

    async def fake_chat_completion(payload):
        calls.append(payload)
        return _completion_response(json.dumps({"level": "LOW", "reason": "ok"}))

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(llm_router, "fetch_llm_routing_config", fake_fetch_config)
    monkeypatch.setattr(prompt_loader, "fetch_prompt", fake_fetch_prompt)

    result = await invoke_llm_json(
        "risk_analysis",
        {"operation": "risk_analysis", "amount": 100},
        create_chat_completion=fake_chat_completion,
    )

    assert result["level"] == "LOW"
    assert len(calls) == 1
    assert calls[0]["metadata"]["config_source"] == "mcp"
    assert calls[0]["metadata"]["prompt_source"] == "mcp"
    assert calls[0]["messages"][0]["content"] == "MCP risk analysis prompt"
