"""MCP resource registration (Stage 7B config, Stage 7C account context)."""

import json
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from mcp_server.account_context import build_current_account_context

PROJECT_ROOT = Path(__file__).resolve().parents[1]
LLM_ROUTING_CONFIG_PATH = PROJECT_ROOT / "config" / "llm_routing.json"


def register_resources(mcp: FastMCP) -> None:
    """Expose LLM routing config and account context over MCP."""

    @mcp.resource("config://llm_routing")
    def llm_routing_config() -> str:
        """LLM routing configuration (mirrors config/llm_routing.json)."""
        raw = LLM_ROUTING_CONFIG_PATH.read_text(encoding="utf-8")
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise RuntimeError("llm_routing.json must contain a JSON object")
        return json.dumps(parsed, ensure_ascii=False)

    @mcp.resource("account://current/{user_id}")
    def current_account_context(user_id: str) -> str:
        """Safe current account context for the authenticated user (account://current)."""
        context = build_current_account_context(user_id)
        return json.dumps(context, ensure_ascii=False)

