"""MCP-backed account context and deterministic risk helpers (Stage 7C)."""

from __future__ import annotations

from config import settings
from ai.llm.errors import LLMRoutingError, PromptLoadError
from ai.mcp.mcp_client import MCPFetchError, call_evaluate_det_risk, fetch_current_account


def _account_balance(account: dict) -> float:
    try:
        return float((account or {}).get("balance") or 0)
    except (TypeError, ValueError):
        return 0.0


def _mcp_fallback_metadata(err: MCPFetchError) -> dict:
    return {
        "mcp_fallback": True,
        "mcp_error": str(err),
    }


def _local_evaluate_deterministic_risk(*, services: dict | None, payload: dict) -> dict:
    risk_service = (services or {}).get("riskService")
    if not risk_service:
        from ai.services.risk_service import create_risk_service
        risk_service = create_risk_service()

    evaluator = getattr(risk_service, "evaluateRisk", None) or getattr(risk_service, "evaluate_risk", None)
    if not evaluator:
        return {
            "status": "not_evaluated",
            "level": "HIGH",
            "score": None,
            "requiresReview": True,
            "reasons": ["Risk service unavailable."],
        }
    return evaluator(payload)


async def resolve_sender_account_context(
    *,
    sender_user: dict,
    sender_account: dict,
) -> tuple[float, str, dict]:
    local_balance = _account_balance(sender_account)
    if not settings.MCP_ENABLED:
        return local_balance, "local", {}

    user_id = str((sender_user or {}).get("_id") or "").strip()
    if not user_id:
        return local_balance, "local", {}

    try:
        context = await fetch_current_account(user_id)
        balance = context.get("balance")
        if balance is None:
            raise MCPFetchError("MCP account context did not include balance")
        return float(balance), "mcp", {}
    except MCPFetchError as err:
        if not settings.MCP_FALLBACK_TO_LOCAL:
            raise PromptLoadError(
                "MCP account context fetch failed and fallback is disabled"
            ) from err
        return local_balance, "local", _mcp_fallback_metadata(err)


async def evaluate_deterministic_transfer_risk(
    *,
    payload: dict,
    services: dict | None,
) -> tuple[dict, str, dict]:
    if not settings.MCP_ENABLED:
        return _local_evaluate_deterministic_risk(services=services, payload=payload), "local", {}

    try:
        result = await call_evaluate_det_risk(payload)
        return result, "mcp", {}
    except MCPFetchError as err:
        if not settings.MCP_FALLBACK_TO_LOCAL:
            raise LLMRoutingError(
                "MCP evaluate_det_risk failed and fallback is disabled"
            ) from err
        return (
            _local_evaluate_deterministic_risk(services=services, payload=payload),
            "local",
            _mcp_fallback_metadata(err),
        )
