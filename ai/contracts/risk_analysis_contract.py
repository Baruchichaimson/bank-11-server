from ai.shared.json_safe import make_json_safe


VALID_RISK_LEVELS = {"LOW", "MEDIUM", "HIGH"}
DEFAULT_RISK_REASON = "Risk analysis unavailable; defaulting to high risk."


def _is_plain_object(value) -> bool:
    return value is not None and isinstance(value, dict)


def _normalize_optional_string(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_risk_level(value) -> str:
    level = str(value or "").strip().upper()
    return level if level in VALID_RISK_LEVELS else "HIGH"


def _normalize_reason(value) -> str:
    reason = str(value or "").strip()
    return reason or DEFAULT_RISK_REASON


def create_risk_analysis(
    *,
    level="HIGH",
    reason=None,
    model=None,
    provider=None,
    raw=None,
) -> dict:
    return {
        "level": _normalize_risk_level(level),
        "reason": _normalize_reason(reason),
        "model": _normalize_optional_string(model),
        "provider": _normalize_optional_string(provider),
        "raw": make_json_safe(raw) if _is_plain_object(raw) else {},
    }


def normalize_risk_analysis(value=None) -> dict:
    if not _is_plain_object(value):
        return create_risk_analysis(raw={})

    return create_risk_analysis(
        level=value.get("level"),
        reason=value.get("reason"),
        model=value.get("model"),
        provider=value.get("provider"),
        raw=value,
    )
