"""
Deterministic detection for transaction / transfer history queries.
"""

import re

from ai.contracts.intent_result_contract import create_intent_result
from ai.intents.llm_semantic_parser import _validate_semantic_query

_TRANSFER_CREATION_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"תבצע.*העברה",
        r"לבצע.*העברה",
        r"בצע\s+העברה",
        r"להעביר\s+כסף",
        r"אני\s+רוצה\s+להעביר",
        r"העבר\s+כסף",
        r"\bmake\s+a\s+transfer\b",
        r"\bsend\s+money\b",
        r"\btransfer\s+money\b",
        r"\bnew\s+transfer\b",
    )
)

_HISTORY_SUBJECT_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"העברות",
        r"תנועות",
        r"עסקאות",
        r"\btransactions?\b",
        r"\btransfers\b",
    )
)

_HISTORY_CONTEXT_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"אחרונות?",
        r"אחרון",
        r"שביצעתי",
        r"ששלחתי",
        r"שקיבלתי",
        r"עשיתי",
        r"ביצעתי",
        r"תראה",
        r"הצג",
        r"מה הם",
        r"איזה",
        r"כמה",
        r"\brecent\b",
        r"\blast\b",
        r"\bshow\b",
        r"\blist\b",
        r"\bhistory\b",
        r"\bfrom\b",
        r"בחודש",
        r"חודש שעבר",
        r"החודש",
        r"השבוע",
        r"היום",
        r"last month",
        r"this month",
        r"this week",
        r"today",
    )
)

_CANONICAL_HISTORY_PHRASES = frozenset({
    "העברות אחרונות",
    "תנועות אחרונות",
    "עסקאות אחרונות",
    "תראה לי את ההעברות האחרונות",
    "recent transactions",
    "last transfers",
})


def _normalize_text(text: str) -> str:
    normalized = str(text or "").strip().lower()
    normalized = re.sub(r"[?!.,:;\"'()\[\]{}]+", "", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _is_transfer_creation_request(user_input: str) -> bool:
    text = str(user_input or "").strip()
    if not text:
        return False
    return any(pattern.search(text) for pattern in _TRANSFER_CREATION_PATTERNS)


def _looks_like_transaction_history_query(user_input: str) -> bool:
    text = str(user_input or "").strip()
    if not text or _is_transfer_creation_request(text):
        return False

    normalized = _normalize_text(text)
    if normalized in _CANONICAL_HISTORY_PHRASES:
        return True

    has_subject = any(pattern.search(text) for pattern in _HISTORY_SUBJECT_PATTERNS)
    has_context = any(pattern.search(text) for pattern in _HISTORY_CONTEXT_PATTERNS)
    return has_subject and has_context


def _extract_limit(text: str) -> int | None:
    patterns = (
        r"(?<!\d)(\d{1,2})\s*(?:העברות|תנועות|עסקאות|transfers|transactions)",
        r"מה הם\s+(\d+)",
        r"(?:last|recent)\s+(\d+)",
        r"(\d+)\s+(?:last|recent)",
    )
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            continue
        value = int(match.group(1))
        if 1 <= value <= 100:
            return value
    return None


def _extract_time_range(text: str) -> str | None:
    if re.search(r"בחודש שעבר|חודש שעבר|last month", text, re.IGNORECASE):
        return "last_month"
    if re.search(r"החודש|this month", text, re.IGNORECASE):
        return "this_month"
    if re.search(r"השבוע|this week", text, re.IGNORECASE):
        return "this_week"
    if re.search(r"היום|today", text, re.IGNORECASE):
        return "today"
    return None


def _extract_direction(text: str) -> str | None:
    if re.search(r"שביצעתי|ששלחתי|ביצעתי|עשיתי|\boutgoing\b|\bsent\b|\bperformed\b", text, re.IGNORECASE):
        return "outgoing"
    if re.search(r"שקיבלתי|\bincoming\b|\breceived\b", text, re.IGNORECASE):
        return "incoming"
    return None


def _extract_type_filter(text: str) -> str | None:
    if re.search(r"העברות|\btransfers\b", text, re.IGNORECASE):
        return "transfer"
    return None


def _is_count_query(text: str) -> bool:
    return bool(re.search(r"^כמה\s|^how many\b", text.strip(), re.IGNORECASE))


def _build_semantic_query(text: str) -> dict:
    limit = _extract_limit(text)
    time_range = _extract_time_range(text)
    direction = _extract_direction(text)
    type_filter = _extract_type_filter(text)

    if _is_count_query(text):
        aggregation = "count"
        limit_value = None
    elif limit is not None:
        aggregation = "first_n"
        limit_value = limit
    else:
        aggregation = "list"
        limit_value = None

    filters = {"type": type_filter}
    if direction:
        filters["direction"] = direction

    raw = {
        "domain": "transactions",
        "intent": "transactions_query",
        "action": "transfer_money" if type_filter == "transfer" else None,
        "filters": filters,
        "timeRange": time_range,
        "aggregation": aggregation,
        "limit": limit_value,
        "sortDirection": "desc",
    }
    validated = _validate_semantic_query(raw)
    if validated:
        return validated

    return {
        "domain": "transactions",
        "intent": "transactions_query",
        "action": "transfer_money" if type_filter == "transfer" else None,
        "filters": {"type": type_filter},
        "timeRange": time_range,
        "aggregation": "list",
        "limit": None,
        "sortDirection": "desc",
    }


def detect_transaction_history_intent(user_input: str) -> dict | None:
    if not _looks_like_transaction_history_query(user_input):
        return None

    semantic_query = _build_semantic_query(user_input)
    return create_intent_result(
        source="transaction_history_guard",
        domain="transactions",
        intent="recent_transactions",
        confidence=0.92,
        semantic_query=semantic_query,
    )
