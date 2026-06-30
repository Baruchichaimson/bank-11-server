"""MCP client for prompt and config retrieval (Stage 7B)."""

from __future__ import annotations

import json
from typing import Any

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client
from mcp.types import AnyUrl, TextContent

from config import settings

LLM_ROUTING_RESOURCE_URI = "config://llm_routing"
ACCOUNT_CURRENT_RESOURCE_PREFIX = "account://current"

PROMPT_FILE_TO_MCP_NAME: dict[str, str] = {
    "prompts/user_intent.md": "user_intent",
    "prompts/risk_analysis.md": "risk_analysis",
    "prompts/risk_judge.md": "risk_judge",
    "prompts/response/default.md": "assistant_response",
}


class MCPFetchError(Exception):
    """Raised when MCP prompt or config retrieval fails."""


def mcp_prompt_name_for_path(prompt_file: str) -> str | None:
    return PROMPT_FILE_TO_MCP_NAME.get(str(prompt_file or "").strip())


def _mcp_server_url() -> str:
    url = str(settings.MCP_SERVER_URL or "").strip().rstrip("/")
    if not url:
        raise MCPFetchError("MCP_SERVER_URL is not configured")
    return url


def _timeout_seconds() -> float:
    return max(settings.MCP_TIMEOUT_MS, 1) / 1000.0


def _extract_prompt_text(result) -> str:
    parts: list[str] = []
    for message in getattr(result, "messages", None) or []:
        content = getattr(message, "content", None)
        if isinstance(content, str) and content.strip():
            parts.append(content.strip())
            continue
        if isinstance(content, TextContent) and content.text.strip():
            parts.append(content.text.strip())
            continue
        if isinstance(content, dict):
            text = str(content.get("text") or "").strip()
            if text:
                parts.append(text)
    text = "\n".join(parts).strip()
    if not text:
        raise MCPFetchError("MCP prompt response was empty")
    return text


def _extract_resource_json(result) -> dict[str, Any]:
    for content in getattr(result, "contents", None) or []:
        text = getattr(content, "text", None)
        if isinstance(text, str) and text.strip():
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
            raise MCPFetchError("MCP resource did not return a JSON object")
    raise MCPFetchError("MCP resource response was empty")


def _extract_tool_json(result) -> dict[str, Any]:
    for content in getattr(result, "content", None) or []:
        text = getattr(content, "text", None)
        if isinstance(text, str) and text.strip():
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
            raise MCPFetchError("MCP tool did not return a JSON object")
        if hasattr(content, "type") and getattr(content, "type", None) == "text":
            parsed = json.loads(getattr(content, "text", "") or "")
            if isinstance(parsed, dict):
                return parsed
    structured = getattr(result, "structuredContent", None)
    if isinstance(structured, dict):
        return structured
    raise MCPFetchError("MCP tool response was empty")


def account_current_resource_uri(user_id: str) -> str:
    user_key = str(user_id or "").strip()
    if not user_key:
        raise MCPFetchError("user_id is required for account://current")
    return f"{ACCOUNT_CURRENT_RESOURCE_PREFIX}/{user_key}"


async def _with_mcp_session(handler):
    timeout_seconds = _timeout_seconds()
    client_timeout = httpx.Timeout(timeout_seconds, read=max(timeout_seconds, 30.0))
    try:
        async with create_mcp_http_client(timeout=client_timeout) as http_client:
            async with streamable_http_client(
                _mcp_server_url(),
                http_client=http_client,
            ) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    return await handler(session)
    except MCPFetchError:
        raise
    except Exception as err:
        raise MCPFetchError(f"MCP request failed: {err}") from err


async def fetch_prompt(mcp_name: str) -> str:
    name = str(mcp_name or "").strip()
    if not name:
        raise MCPFetchError("MCP prompt name is required")

    async def _handler(session: ClientSession) -> str:
        result = await session.get_prompt(name, arguments={})
        return _extract_prompt_text(result)

    return await _with_mcp_session(_handler)


async def fetch_llm_routing_config() -> dict[str, Any]:
    async def _handler(session: ClientSession) -> dict[str, Any]:
        result = await session.read_resource(AnyUrl(LLM_ROUTING_RESOURCE_URI))
        return _extract_resource_json(result)

    return await _with_mcp_session(_handler)


async def fetch_current_account(user_id: str) -> dict[str, Any]:
    uri = account_current_resource_uri(user_id)

    async def _handler(session: ClientSession) -> dict[str, Any]:
        result = await session.read_resource(AnyUrl(uri))
        return _extract_resource_json(result)

    return await _with_mcp_session(_handler)


async def call_evaluate_det_risk(payload: dict[str, Any]) -> dict[str, Any]:
    arguments = {
        "senderEmail": payload.get("senderEmail", ""),
        "receiverEmail": payload.get("receiverEmail", ""),
        "amount": float(payload.get("amount", 0)),
        "senderBalance": float(payload.get("senderBalance", 0)),
    }

    async def _handler(session: ClientSession) -> dict[str, Any]:
        result = await session.call_tool("evaluate_det_risk", arguments=arguments)
        return _extract_tool_json(result)

    return await _with_mcp_session(_handler)
