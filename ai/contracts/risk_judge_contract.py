from ai.shared.json_safe import make_json_safe


VALID_APPROVALS = {"ACCEPTED", "DENIED"}
DEFAULT_JUDGE_REASON = "Risk judge unavailable; denying by default."


def _is_plain_object(value) -> bool:
    return value is not None and isinstance(value, dict)


def _normalize_optional_string(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_approval(value) -> str:
    approval = str(value or "").strip().upper()
    return approval if approval in VALID_APPROVALS else "DENIED"


def _normalize_reason(value) -> str:
    reason = str(value or "").strip()
    return reason or DEFAULT_JUDGE_REASON


def create_risk_judge(
    *,
    approval="DENIED",
    reason=None,
    model=None,
    provider=None,
    raw=None,
) -> dict:
    return {
        "approval": _normalize_approval(approval),
        "reason": _normalize_reason(reason),
        "model": _normalize_optional_string(model),
        "provider": _normalize_optional_string(provider),
        "raw": make_json_safe(raw) if _is_plain_object(raw) else {},
    }


def normalize_risk_judge(value=None) -> dict:
    if not _is_plain_object(value):
        return create_risk_judge(raw={})

    return create_risk_judge(
        approval=value.get("approval"),
        reason=value.get("reason"),
        model=value.get("model"),
        provider=value.get("provider"),
        raw=value,
    )
