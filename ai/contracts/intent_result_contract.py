def _is_plain_object(value) -> bool:
    return value is not None and isinstance(value, dict)


def _normalize_confidence(value, fallback=0.0) -> float:
    try:
        n = float(value)
        if not (n == n):  # NaN check
            return fallback
        return min(max(n, 0.0), 1.0)
    except (TypeError, ValueError):
        return fallback


def _normalize_object_or_none(value):
    return value if _is_plain_object(value) else None


def _normalize_workflow_continuation(value):
    if _is_plain_object(value):
        return value
    if value is True:
        return {"active": True}
    return None


def _normalize_tool(*, tool=None, tool_name=None, tool_args=None):
    raw_name = tool.get("name") if _is_plain_object(tool) else (tool_name or tool)
    name = str(raw_name or "").strip()
    if not name:
        return None
    raw_args = tool.get("args") if _is_plain_object(tool) else (tool_args or {})
    return {"name": name, "args": raw_args if _is_plain_object(raw_args) else {}}


def _normalize_ambiguity(*, ambiguity=None, is_ambiguous=False, ambiguity_reason=None):
    raw = ambiguity if _is_plain_object(ambiguity) else None
    reason = (raw or {}).get("reason") or ambiguity_reason
    options = (raw or {}).get("options") if isinstance((raw or {}).get("options"), list) else None
    ambiguous = bool((raw or {}).get("isAmbiguous") or is_ambiguous or reason or (options and len(options)))
    if not ambiguous:
        return None
    return {
        "isAmbiguous": True,
        "reason": str(reason) if reason else None,
        **({"options": options} if options else {}),
    }


def create_intent_result(
    *,
    domain="unknown",
    intent="unknown",
    confidence=0,
    source="safe_unknown",
    workflow_continuation=None,
    semantic_query=None,
    transfer_payload=None,
    correction=None,
    tool=None,
    ambiguity=None,
    tool_name=None,
    tool_args=None,
    is_ambiguous=False,
    ambiguity_reason=None,
) -> dict:
    return {
        "domain": str(domain or "unknown"),
        "intent": str(intent or "unknown"),
        "confidence": _normalize_confidence(confidence),
        "source": str(source or "safe_unknown"),
        "workflowContinuation": _normalize_workflow_continuation(workflow_continuation),
        "semanticQuery": _normalize_object_or_none(semantic_query),
        "transferPayload": _normalize_object_or_none(transfer_payload),
        "correction": _normalize_object_or_none(correction),
        "tool": _normalize_tool(tool=tool, tool_name=tool_name, tool_args=tool_args),
        "ambiguity": _normalize_ambiguity(ambiguity=ambiguity, is_ambiguous=is_ambiguous, ambiguity_reason=ambiguity_reason),
    }


def create_unknown_intent(
    *,
    source="safe_unknown",
    confidence=0,
    workflow_continuation=None,
    semantic_query=None,
    transfer_payload=None,
    correction=None,
    tool=None,
    ambiguity=None,
) -> dict:
    return create_intent_result(
        domain="unknown",
        intent="unknown",
        confidence=confidence,
        source=source,
        workflow_continuation=workflow_continuation,
        semantic_query=semantic_query,
        transfer_payload=transfer_payload,
        correction=correction,
        tool=tool,
        ambiguity=ambiguity,
    )


def create_ambiguous_intent(
    *,
    source="safe_unknown",
    reason=None,
    options=None,
    confidence=0,
    workflow_continuation=None,
    semantic_query=None,
    transfer_payload=None,
    correction=None,
    tool=None,
) -> dict:
    return create_unknown_intent(
        source=source,
        confidence=confidence,
        workflow_continuation=workflow_continuation,
        semantic_query=semantic_query,
        transfer_payload=transfer_payload,
        correction=correction,
        tool=tool,
        ambiguity={
            "isAmbiguous": True,
            "reason": reason,
            **({"options": options} if isinstance(options, list) else {}),
        },
    )


def normalize_intent_result(value: dict | None) -> dict:
    if not value:
        return create_unknown_intent()
    return create_intent_result(
        domain=value.get("domain"),
        intent=value.get("intent"),
        confidence=value.get("confidence"),
        source=value.get("source"),
        workflow_continuation=value.get("workflowContinuation"),
        semantic_query=value.get("semanticQuery"),
        transfer_payload=value.get("transferPayload"),
        correction=value.get("correction"),
        tool=value.get("tool"),
        tool_name=value.get("toolName") or value.get("name"),
        tool_args=value.get("toolArgs") or value.get("args"),
        ambiguity=value.get("ambiguity"),
        is_ambiguous=value.get("isAmbiguous", False),
        ambiguity_reason=value.get("ambiguityReason"),
    )
