"""
Deterministic guards for casual greetings and unsupported support routing.
"""

import re

from ai.contracts.intent_result_contract import create_unknown_intent

_PUNCT_RE = re.compile(r"[?!.,:;\"'()\[\]{}]+")
_WS_RE = re.compile(r"\s+")

CASUAL_SMALL_TALK_PHRASES = frozenset({
    "מה קורה",
    "מה נשמע",
    "מה המצב",
    "היי",
    "שלום",
    "בוקר טוב",
    "ערב טוב",
    "צהריים טובים",
    "אהלן",
    "hi",
    "hello",
    "hey",
    "how are you",
    "good morning",
    "good evening",
    "good afternoon",
    "whats up",
})

_BANKING_CONTEXT_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"העברות?",
        r"תנועות",
        r"עסקאות",
        r"חשבון",
        r"יתרה",
        r"\btransfers?\b",
        r"\btransactions?\b",
        r"\bbalance\b",
    )
)

_EXPLICIT_SUPPORT_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"נציג",
        r"בנקאי",
        r"שיחת\s*וידאו|שיחה\s*וידאו",
        r"\bוידאו\b",
        r"video\s*call",
        r"לדבר\s+עם",
        r"talk\s+to",
        r"תתקשר|תחבר",
        r"בעיה\s+(ב|עם)\s*(ה)?חשבון",
        r"account\s+(problem|issue|trouble)",
        r"\bsupport\b",
        r"representative",
        r"\bagent\b",
        r"banker",
        r"contact\s+(support|agent|representative)",
        r"need\s+support",
        r"אני\s+צריך\s+(נציג|תמיכה)",
        r"פתח.*וידאו",
        r"open\s+(a\s+)?video",
    )
)


def normalize_casual_message(text: str) -> str:
    normalized = str(text or "").strip().lower()
    normalized = _PUNCT_RE.sub("", normalized)
    normalized = _WS_RE.sub(" ", normalized).strip()
    return normalized


def is_casual_small_talk(user_input: str) -> bool:
    normalized = normalize_casual_message(user_input)
    return bool(normalized) and normalized in CASUAL_SMALL_TALK_PHRASES


def has_explicit_support_intent(user_input: str) -> bool:
    text = str(user_input or "").strip()
    if not text:
        return False
    return any(pattern.search(text) for pattern in _EXPLICIT_SUPPORT_PATTERNS)


def has_banking_context(user_input: str) -> bool:
    text = str(user_input or "").strip()
    if not text:
        return False
    return any(pattern.search(text) for pattern in _BANKING_CONTEXT_PATTERNS)


def should_route_as_unknown(*, user_input: str, llm_intent: str | None = None) -> bool:
    if (
        is_casual_small_talk(user_input)
        and not has_explicit_support_intent(user_input)
        and not has_banking_context(user_input)
    ):
        return True
    if llm_intent == "contact_support" and not has_explicit_support_intent(user_input):
        return True
    return False


def guard_intent_routing(*, user_input: str, parsed: dict | None = None) -> dict | None:
    llm_intent = (parsed or {}).get("intent")
    if should_route_as_unknown(user_input=user_input, llm_intent=llm_intent):
        return create_unknown_intent(source="casual_phrase_guard")
    return None
