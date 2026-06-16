"""
Intent detection — port of detectIntent.js.
"""

import re
from ai.intents.llm_semantic_parser import parse_query_with_llm, validate_llm_semantic_parse, _validate_semantic_query
from ai.intents.llm_prompt_payload_builder import get_current_date_for_prompt
from ai.contracts.intent_result_contract import create_intent_result, create_unknown_intent, normalize_intent_result

_LLM_UNAVAILABLE = create_unknown_intent(source="llm_unavailable")
_LLM_PARSE_FAILED = create_unknown_intent(source="llm_parse_failed")


def _normalize_user_text(value: str) -> str:
    text = str(value or "").strip()
    text = re.sub(r"[־–—]", "-", text)
    text = re.sub(r'["\'.,!?;:()[\]{}]', " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.lower()


def _text_has_transaction_noun(text: str) -> bool:
    nouns = ["העברה", "העברות", "פעולה", "פעולות", "טרנזקציה", "טרנזקציות",
             "transfer", "transfers", "transaction", "transactions", "activity", "activities"]
    return any(n in text for n in nouns)


def _is_transaction_count_question(user_input: str) -> bool:
    text = _normalize_user_text(user_input)
    asks_count = (
        bool(re.search(r"(?:^|\s)כמה(?:\s|$)", text))
        or bool(re.search(r"מה\s+(?:מספר|כמות)\s+ה", text))
        or bool(re.search(r"how\s+many", text, re.IGNORECASE))
        or bool(re.search(r"\bcount\b", text, re.IGNORECASE))
        or bool(re.search(r"\bnumber\s+of\b", text, re.IGNORECASE))
    )
    return asks_count and _text_has_transaction_noun(text)


_TRANSACTION_LIST_NOUN_PATTERN = r"(?:ה?העברות?|ה?העברה|ה?פעולות?|ה?פעולה|ה?טרנזקציות?|ה?טרנזקציה|transfers?|transactions?|activities|activity)"
_SINGULAR_TRANSACTION_NOUN_PATTERN = r"(?:ה?העברה|ה?פעולה|ה?טרנזקציה|transfer|transaction|activity)"
_SINGLE_VALUE_PATTERN = r"(?:1|אחד|אחת|one|single)"
_ORDER_WORD_PATTERN = r"(?:אחרונה|אחרון|ראשונה|ראשון|latest|newest|first|earliest|oldest|most\s+recent)"


def _has_explicit_single_row_request(text: str) -> bool:
    return (
        bool(re.search(rf"(?:^|\s){_SINGLE_VALUE_PATTERN}\s+{_TRANSACTION_LIST_NOUN_PATTERN}(?:\s|$)", text, re.IGNORECASE))
        or bool(re.search(rf"{_TRANSACTION_LIST_NOUN_PATTERN}\s+{_SINGLE_VALUE_PATTERN}(?:\s|$)", text, re.IGNORECASE))
        or bool(re.search(rf"{_SINGULAR_TRANSACTION_NOUN_PATTERN}\s+(?:ה)?{_ORDER_WORD_PATTERN}(?:\s|$)", text, re.IGNORECASE))
        or bool(re.search(rf"(?:^|\s){_ORDER_WORD_PATTERN}\s+{_SINGULAR_TRANSACTION_NOUN_PATTERN}(?:\s|$)", text, re.IGNORECASE))
    )


_HEBREW_TRANSFER_START_PATTERNS = [
    re.compile(r"(?:^|\s)(?:תבצע|בצע|לבצע|תעשה|לעשות)\s+(?:לי\s+)?העברה(?:\s|$)"),
    re.compile(r"(?:^|\s)(?:אני\s+)?(?:רוצה|צריך|צריכה|מעוניין|מעוניינת)\s+(?:לבצע|לעשות)\s+(?:לי\s+)?העברה(?:\s|$)"),
    re.compile(r"(?:^|\s)(?:תפתח|פתח|לפתוח)\s+(?:לי\s+)?העברה(?:\s|$)"),
    re.compile(r"(?:^|\s)(?:אני\s+)?(?:רוצה|צריך|צריכה|מעוניין|מעוניינת)\s+להעביר\s+כסף(?:\s|$)"),
    re.compile(r"(?:^|\s)(?:תעביר|העבר)\s+(?:לי\s+)?כסף(?:\s|$)"),
]

_HEBREW_BALANCE_PATTERNS = [
    re.compile(r"(?:^|\s)מה\s+ה?יי?תרה(?:\s+שלי)?(?:\s+בחשבון(?:\s+שלי)?)?(?:\s|$)"),
    re.compile(r"(?:^|\s)כמה\s+כסף\s+יש\s+לי(?:\s+בחשבון(?:\s+שלי)?)?(?:\s|$)"),
    re.compile(r"(?:^|\s)(?:תראה|הראה|הצג|תציג)\s+(?:לי\s+)?ה?יי?תרה(?:\s|$)"),
]

_HEBREW_PROFILE_PATTERNS = [
    re.compile(r"(?:^|\s)מה\s+ה?שם\s+שלי(?:\s|$)"),
    re.compile(r"(?:^|\s)מה\s+ה?(?:מייל|אימייל)\s+שלי(?:\s|$)"),
    re.compile(r"(?:^|\s)איזה\s+(?:מייל|אימייל)\s+יש\s+לי\s+במערכת(?:\s|$)"),
    re.compile(r"(?:^|\s)מה\s+ה?פרטים(?:\s+האישיים)?\s+שלי(?:\s|$)"),
]

_HEBREW_SUPPORT_PATTERNS = [
    re.compile(r"(?:^|\s)(?:תתקשר|התקשר|תתקשרו|תתקשרי)\s+(?:לי\s+)?(?:אל\s+)?ל?נציג(?:\s|$)"),
    re.compile(r"(?:^|\s)(?:אני\s+)?(?:רוצה|צריך|צריכה|מעוניין|מעוניינת)\s+לדבר\s+עם\s+נציג(?:\s|$)"),
    re.compile(r"(?:^|\s)אפשר\s+(?:לדבר\s+עם\s+)?נציג(?:\s|$)"),
    re.compile(r"(?:^|\s)(?:תחבר|חבר|חברי|חברו)\s+(?:אותי|לי)\s+(?:אל\s+|עם\s+|ל)?נציג(?:\s|$)"),
    re.compile(r"(?:^|\s)(?:תפתח|פתח|פתחי|פתחו)\s+(?:לי\s+)?שיחה\s+עם\s+נציג(?:\s|$)"),
    re.compile(r"(?:^|\s)(?:אני\s+)?(?:צריך|צריכה|רוצה)\s+עזרה\s+(?:מנציג|עם\s+נציג)(?:\s|$)"),
    re.compile(r"(?:^|\s)שיחת\s+וידאו\s+עם\s+נציג(?:\s|$)"),
    re.compile(r"(?:^|\s)(?:תעשה|עשה|עשי|עשו)\s+(?:לי\s+)?שיחה\s+עם\s+נציג(?:\s|$)"),
    re.compile(r"(?:^|\s)צור\s+קשר\s+עם\s+נציג(?:\s|$)"),
]

_HEBREW_SCRIPT_RE = re.compile(r"[\u0590-\u05FF]")


def _is_hebrew(text: str) -> bool:
    return bool(_HEBREW_SCRIPT_RE.search(text))


def _is_obvious_hebrew_transfer_start(user_input: str) -> bool:
    text = _normalize_user_text(user_input)
    if not _is_hebrew(text):
        return False
    if _is_transaction_count_question(user_input):
        return False
    return any(p.search(text) for p in _HEBREW_TRANSFER_START_PATTERNS)


def _is_obvious_hebrew_balance_request(user_input: str) -> bool:
    text = _normalize_user_text(user_input)
    if not _is_hebrew(text):
        return False
    return any(p.search(text) for p in _HEBREW_BALANCE_PATTERNS)


def _is_obvious_hebrew_profile_request(user_input: str) -> bool:
    text = _normalize_user_text(user_input)
    if not _is_hebrew(text):
        return False
    return any(p.search(text) for p in _HEBREW_PROFILE_PATTERNS)


def _is_obvious_hebrew_support_request(user_input: str) -> bool:
    text = _normalize_user_text(user_input)
    if not _is_hebrew(text):
        return False
    return any(p.search(text) for p in _HEBREW_SUPPORT_PATTERNS)


def _apply_deterministic_fallback(*, user_input: str, final_parse: dict) -> dict:
    if final_parse["intent"] != "unknown":
        return final_parse
    if (final_parse.get("ambiguity") or {}).get("isAmbiguous"):
        return final_parse
    if _is_obvious_hebrew_transfer_start(user_input):
        return create_intent_result(domain="transactions", intent="transfer_money", confidence=0.9, source="deterministic_hebrew_transfer_start")
    if _is_obvious_hebrew_balance_request(user_input):
        return create_intent_result(domain="account", intent="check_balance", confidence=0.9, source="deterministic_hebrew_balance")
    if _is_obvious_hebrew_profile_request(user_input):
        return create_intent_result(domain="profile", intent="show_personal_details", confidence=0.9, source="deterministic_hebrew_profile")
    if _is_obvious_hebrew_support_request(user_input):
        return create_intent_result(domain="support", intent="contact_support", confidence=0.9, source="deterministic_hebrew_support")
    return final_parse


def _create_transaction_count_semantic_query() -> dict:
    return {
        "domain": "transactions",
        "intent": "transactions_query",
        "action": "transfer_money",
        "filters": {"type": "transfer"},
        "timeRange": None,
        "aggregation": "count",
        "limit": None,
    }


def _fix_list_question_limit_one(*, user_input: str, semantic_query: dict | None) -> dict | None:
    if not semantic_query:
        return semantic_query
    text = _normalize_user_text(user_input)
    should_fix = (
        semantic_query.get("aggregation") == "first_n"
        and semantic_query.get("limit") == 1
        and _text_has_transaction_noun(text)
        and not _is_transaction_count_question(user_input)
        and not _has_explicit_single_row_request(text)
    )
    if not should_fix:
        return semantic_query
    return {**semantic_query, "aggregation": "list", "limit": None}


def _normalize_final_semantic_query(*, user_input: str, final_parse: dict) -> dict | None:
    should_force_count = _is_transaction_count_question(user_input)
    should_normalize = should_force_count or (
        final_parse.get("domain") == "transactions"
        and final_parse.get("intent") == "recent_transactions"
    )

    if not should_normalize:
        return final_parse.get("semanticQuery")

    if should_force_count:
        seed = {
            **_create_transaction_count_semantic_query(),
            **(final_parse.get("semanticQuery") or {}),
            "filters": {"type": "transfer", **(final_parse.get("semanticQuery") or {}).get("filters", {})},
            "aggregation": "count",
            "limit": None,
        }
    else:
        seed = final_parse.get("semanticQuery")

    guarded = _fix_list_question_limit_one(user_input=user_input, semantic_query=seed)
    return _validate_semantic_query(guarded) or final_parse.get("semanticQuery")


def _normalize_final_parse(*, user_input: str, final_parse: dict) -> dict:
    if not _is_transaction_count_question(user_input):
        return final_parse
    # Exclude keys that are explicitly overridden below to avoid "multiple values" TypeError.
    # In JS, {...obj, key: val} silently overwrites; in Python it raises.
    overridden = {"domain", "intent", "confidence", "tool", "ambiguity"}
    base = {k: v for k, v in final_parse.items() if k not in overridden}
    return create_intent_result(
        **base,
        domain="transactions",
        intent="recent_transactions",
        confidence=final_parse.get("confidence") or 0.95,
        tool=None,
        ambiguity=None,
    )


async def detect_intent(
    *,
    user_input: str,
    history: list = None,
    create_chat_completion=None,
    abort_signal=None,
) -> dict:
    parsed = await parse_query_with_llm(
        user_input=user_input,
        history=history or [],
        create_chat_completion=create_chat_completion,
        abort_signal=abort_signal,
    )
    llm_parsed = normalize_intent_result(parsed) if parsed else None
    raw_final_parse = llm_parsed or (_LLM_PARSE_FAILED if create_chat_completion else _LLM_UNAVAILABLE)
    fallback_aware = _apply_deterministic_fallback(
        user_input=user_input, final_parse=normalize_intent_result(raw_final_parse)
    )
    final_parse = _normalize_final_parse(user_input=user_input, final_parse=fallback_aware)
    semantic_query = _normalize_final_semantic_query(user_input=user_input, final_parse=final_parse)

    return create_intent_result(
        **{k: v for k, v in final_parse.items() if k not in ("semanticQuery", "source")},
        source=final_parse.get("source", "safe_unknown"),
        semantic_query=semantic_query,
    )
