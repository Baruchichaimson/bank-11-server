"""
LLM semantic parser — port of llmSemanticParser.js.
"""

import asyncio
import json
import re
import sys
import time
from ai.intents.semantic_catalog import (
    ALLOWED_DOMAINS, ALLOWED_INTENTS, ALLOWED_TOOL_NAMES, TOOL_BY_NAME,
    ALLOWED_AGGREGATIONS, ALLOWED_ACTIONS, ALLOWED_TYPES, ALLOWED_DIRECTIONS,
    ALLOWED_TIME_RANGES, ACTION_TO_TYPE, TYPE_TO_ACTION,
)
from ai.intents.llm_prompt_payload_builder import build_user_prompt_payload, get_current_date_for_prompt
from ai.contracts.intent_result_contract import create_intent_result, create_ambiguous_intent
from config.settings import ACTIVE_AI_MODEL, ASSISTANT_DEBUG_ERRORS
from observability.langfuse_tracing import (
    capture_io_enabled,
    get_request_id,
    record_event,
    start_span,
    text_preview,
    trace_log,
)

DOMAIN_ALIASES = {
    "balance": "account", "account_balance": "account",
    "identity": "profile", "user": "profile", "personal": "profile",
    "transfer": "transactions", "transfers": "transactions",
    "transaction": "transactions",
    "representative": "support", "agent": "support", "help": "support",
}

INTENT_ALIASES = {
    "get_user_identity": "show_personal_details", "get_user_name": "show_personal_details",
    "get_user_details": "show_personal_details", "personal_details": "show_personal_details",
    "get_balance": "check_balance", "account_summary": "check_balance", "balance": "check_balance",
    "get_recent_transfers": "recent_transactions", "count_transfers": "recent_transactions",
    "get_last_sent_transfer_to_recipient": "recent_transactions",
    "transactions_query": "recent_transactions",
    "open_money_transfer_inline": "transfer_money",
    "send_money": "transfer_money", "make_transfer": "transfer_money",
    "open_video_call_window": "contact_support",
    "talk_to_agent": "contact_support", "talk_to_representative": "contact_support",
    "contact_agent": "contact_support", "contact_representative": "contact_support",
    "connect_representative": "contact_support", "start_video_call": "contact_support",
    "video_call": "contact_support", "support": "contact_support",
    "representative": "contact_support",
}

UI_ACTION_TOOL_NAMES = {"open_money_transfer_inline", "open_video_call_window"}
ALLOWED_DOMAINS_SET = set(ALLOWED_DOMAINS)
ALLOWED_INTENTS_SET = set(ALLOWED_INTENTS)
ALLOWED_TOOL_NAMES_SET = {t for t in ALLOWED_TOOL_NAMES if t is not None}


def _normalize_enum_string(value) -> str:
    return str(value or "").strip().lower().replace(" ", "_").replace("-", "_")


def _normalize_confidence(value, fallback=0.0) -> float:
    try:
        n = float(value)
        return min(max(n, 0.0), 1.0)
    except (TypeError, ValueError):
        return fallback


def _normalize_domain(value, tool_name=None) -> str:
    normalized = _normalize_enum_string(value)
    from_tool = TOOL_BY_NAME.get(tool_name, {}).get("domain") if tool_name else None
    aliased = DOMAIN_ALIASES.get(normalized, normalized)
    if (not aliased or aliased == "unknown") and from_tool:
        return from_tool
    return aliased if aliased in ALLOWED_DOMAINS_SET else (from_tool or "unknown")


def _normalize_intent(value, tool_name=None) -> str:
    normalized = _normalize_enum_string(value)
    from_tool = TOOL_BY_NAME.get(tool_name, {}).get("intent") if tool_name else None
    aliased = INTENT_ALIASES.get(normalized, normalized)
    if (not aliased or aliased == "unknown") and from_tool:
        return from_tool
    return aliased if aliased in ALLOWED_INTENTS_SET else (from_tool or "unknown")


def _normalize_tool_name(value) -> str | None:
    normalized = _normalize_enum_string(value)
    return normalized if normalized in ALLOWED_TOOL_NAMES_SET else None


def _normalize_nullable(value):
    if value is None or (isinstance(value, str) and value.strip().lower() in ("null", "none", "")):
        return None
    return value


def _normalize_string_field(value) -> str | None:
    v = _normalize_nullable(value)
    if not isinstance(v, str):
        return None
    s = v.strip()
    return s if s else None


def _clamp_limit(value) -> int | None:
    if value is None:
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    if n <= 0 or n > 100:
        return None
    return n


_ISO_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_ALLOWED_ACTIONS_SET = {a for a in ALLOWED_ACTIONS if a is not None}
_ALLOWED_TYPES_SET = {t for t in ALLOWED_TYPES if t is not None}
_ALLOWED_DIRECTIONS_SET = {d for d in ALLOWED_DIRECTIONS if d is not None}
_ALLOWED_TIME_RANGES_SET = set(ALLOWED_TIME_RANGES)
_ALLOWED_AGGREGATIONS_SET = set(ALLOWED_AGGREGATIONS)
_ALLOWED_SORT_DIRS = {"asc", "desc"}


def _normalize_iso_date(value) -> str | None:
    text = _normalize_string_field(value)
    if not text:
        return None
    m = _ISO_DATE_RE.match(text)
    if not m:
        return None
    try:
        from datetime import datetime
        datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None
    return text


def _has_date_range_input(date_range) -> bool:
    return bool(
        date_range
        and isinstance(date_range, dict)
        and not isinstance(date_range, list)
        and (date_range.get("from") or date_range.get("to"))
    )


def _validate_date_range(date_range) -> dict | None:
    if not _has_date_range_input(date_range):
        return None
    from_val = _normalize_iso_date(date_range.get("from"))
    to_val = _normalize_iso_date(date_range.get("to"))
    if (date_range.get("from") and not from_val) or (date_range.get("to") and not to_val):
        return None
    if not from_val and not to_val:
        return None
    if from_val and to_val and from_val > to_val:
        return None
    return {"from": from_val, "to": to_val}


def _normalize_action_and_type(*, action, type_val):
    action = _normalize_nullable(action)
    type_val = _normalize_nullable(type_val)
    action = action if action in _ALLOWED_ACTIONS_SET else None
    type_val = type_val if type_val in _ALLOWED_TYPES_SET else None
    if action:
        type_val = ACTION_TO_TYPE.get(action)
    elif type_val:
        action = TYPE_TO_ACTION.get(type_val)
    return action, type_val


def _validate_semantic_query(raw) -> dict | None:
    if not raw or not isinstance(raw, dict):
        return None
    if raw.get("domain") != "transactions" or raw.get("intent") != "transactions_query":
        return None

    action, type_val = _normalize_action_and_type(
        action=raw.get("action"),
        type_val=(raw.get("filters") or {}).get("type"),
    )
    raw_direction = _normalize_nullable((raw.get("filters") or {}).get("direction"))
    direction = raw_direction if raw_direction in _ALLOWED_DIRECTIONS_SET else None

    raw_time_range = _normalize_nullable(raw.get("timeRange"))
    time_range = raw_time_range if raw_time_range in _ALLOWED_TIME_RANGES_SET else None

    date_range = _validate_date_range(raw.get("dateRange"))
    if _has_date_range_input(raw.get("dateRange")) and not date_range:
        return None

    raw_agg = raw.get("aggregation")
    aggregation = raw_agg if raw_agg in _ALLOWED_AGGREGATIONS_SET else "list"

    raw_sort = _normalize_nullable(raw.get("sortDirection"))
    sort_direction = raw_sort if raw_sort in _ALLOWED_SORT_DIRS else None

    recipient_name = _normalize_string_field(raw.get("recipientName"))
    if aggregation == "counterparty" and not recipient_name:
        return None

    filters = {"type": type_val}
    if direction:
        filters["direction"] = direction

    result = {
        "domain": "transactions",
        "intent": "transactions_query",
        "action": action,
        "filters": filters,
        "timeRange": None if date_range else time_range,
        "aggregation": aggregation,
        "limit": None if aggregation == "count" else _clamp_limit(raw.get("limit")),
    }
    if date_range:
        result["dateRange"] = date_range
    if sort_direction:
        result["sortDirection"] = sort_direction
    if recipient_name:
        result["recipientName"] = recipient_name
    return result


def _build_legacy_semantic_query_from_tool(tool_name: str, tool_args: dict) -> dict | None:
    if tool_name == "count_transfers":
        return {"domain": "transactions", "intent": "transactions_query", "action": "transfer_money",
                "filters": {"type": "transfer"}, "timeRange": None, "aggregation": "count", "limit": None}
    if tool_name == "get_recent_transfers":
        return {"domain": "transactions", "intent": "transactions_query", "action": None,
                "filters": {"type": None}, "timeRange": None, "aggregation": "list", "limit": None}
    if tool_name == "get_last_sent_transfer_to_recipient":
        recipient_name = str(tool_args.get("recipientName") or "").strip()
        if not recipient_name:
            return None
        return {"domain": "transactions", "intent": "transactions_query", "action": "transfer_money",
                "filters": {"type": "transfer"}, "timeRange": None, "aggregation": "counterparty",
                "limit": 10, "recipientName": recipient_name}
    return None


def validate_llm_semantic_parse(payload: dict | None) -> dict | None:
    if not payload or not isinstance(payload, dict):
        return None

    raw_tool = payload.get("tool") if isinstance(payload.get("tool"), dict) else None
    tool_name = _normalize_tool_name(
        payload.get("toolName") or (raw_tool or {}).get("name") or payload.get("tool") or payload.get("name")
    )
    raw_tool_args = payload.get("toolArgs") or (raw_tool or {}).get("args") or payload.get("args") or {}
    tool_args = raw_tool_args if isinstance(raw_tool_args, dict) else {}

    domain = _normalize_domain(payload.get("domain"), tool_name)
    intent = _normalize_intent(payload.get("intent"), tool_name)
    workflow_continuation = payload.get("workflowContinuation")
    correction = payload.get("correction") if isinstance(payload.get("correction"), dict) else None
    transfer_payload = payload.get("transferPayload") if isinstance(payload.get("transferPayload"), dict) else None
    model_confidence = _normalize_confidence(payload.get("confidence"))
    is_ambiguous = payload.get("isAmbiguous") is True
    ambiguity_reason = str(payload.get("ambiguityReason") or "").strip() or None
    has_semantic_query_input = isinstance(payload.get("semanticQuery"), dict)
    should_keep_tool = bool(tool_name and (tool_name in UI_ACTION_TOOL_NAMES or not has_semantic_query_input))
    output_tool = {"name": tool_name, "args": tool_args} if should_keep_tool and tool_name else None

    def build_result(*, result_domain, result_intent, default_confidence, semantic_query=None):
        return create_intent_result(
            source="llm_semantic_parser",
            domain=result_domain,
            intent=result_intent,
            confidence=0 if result_intent == "unknown" else (model_confidence if model_confidence is not None else default_confidence),
            semantic_query=semantic_query,
            workflow_continuation=workflow_continuation,
            correction=correction,
            transfer_payload=transfer_payload,
            tool=output_tool,
            ambiguity={"isAmbiguous": True, "reason": ambiguity_reason} if is_ambiguous else None,
        )

    if is_ambiguous:
        return create_ambiguous_intent(
            source="llm_semantic_parser",
            reason=ambiguity_reason,
            workflow_continuation=workflow_continuation,
            correction=correction,
            transfer_payload=transfer_payload,
            tool=output_tool,
        )

    if model_confidence is not None and model_confidence < 0.65:
        return build_result(result_domain="unknown", result_intent="unknown", default_confidence=0)

    if domain == "unknown" or intent == "unknown":
        return build_result(result_domain="unknown", result_intent="unknown", default_confidence=0)

    if domain == "transactions" and intent == "recent_transactions":
        raw_sq = payload.get("semanticQuery") if has_semantic_query_input else None
        if not raw_sq and tool_name:
            raw_sq = _build_legacy_semantic_query_from_tool(tool_name, tool_args)
        semantic_query = _validate_semantic_query(raw_sq)
        if not semantic_query:
            return None
        return build_result(result_domain=domain, result_intent=intent, default_confidence=0.9, semantic_query=semantic_query)

    expected_by_domain = {
        "profile": "show_personal_details",
        "account": "check_balance",
        "support": "contact_support",
        "unknown": "unknown",
    }
    if expected_by_domain.get(domain) == intent:
        return build_result(result_domain=domain, result_intent=intent, default_confidence=0 if domain == "unknown" else 0.85)

    if domain == "transactions" and intent == "transfer_money":
        return build_result(result_domain=domain, result_intent=intent, default_confidence=0.85)

    return None


def _describe_semantic_query_validation_failure(raw) -> str:
    if not raw or not isinstance(raw, dict):
        return "recent_transactions requires semanticQuery object"
    if raw.get("domain") != "transactions" or raw.get("intent") != "transactions_query":
        return "semanticQuery must have domain=transactions and intent=transactions_query"
    if _has_date_range_input(raw.get("dateRange")) and not _validate_date_range(raw.get("dateRange")):
        return "semanticQuery.dateRange is invalid"
    if raw.get("aggregation") == "counterparty" and not _normalize_string_field(raw.get("recipientName")):
        return "counterparty aggregation requires recipientName"
    return "semanticQuery failed validation"


def _describe_validation_failure(payload: dict | None) -> str:
    if not payload or not isinstance(payload, dict):
        return "LLM output must be a JSON object"

    raw_tool = payload.get("tool") if isinstance(payload.get("tool"), dict) else None
    tool_name = _normalize_tool_name(
        payload.get("toolName") or (raw_tool or {}).get("name") or payload.get("tool") or payload.get("name")
    )
    raw_tool_args = payload.get("toolArgs") or (raw_tool or {}).get("args") or payload.get("args") or {}
    tool_args = raw_tool_args if isinstance(raw_tool_args, dict) else {}

    domain = _normalize_domain(payload.get("domain"), tool_name)
    intent = _normalize_intent(payload.get("intent"), tool_name)
    model_confidence = _normalize_confidence(payload.get("confidence"))

    if model_confidence is not None and model_confidence < 0.65:
        return "confidence below routing threshold"

    if domain == "unknown" or intent == "unknown":
        return f"domain or intent normalized to unknown (domain={domain}, intent={intent})"

    if domain == "transactions" and intent == "recent_transactions":
        raw_sq = payload.get("semanticQuery") if isinstance(payload.get("semanticQuery"), dict) else None
        if not raw_sq and tool_name:
            raw_sq = _build_legacy_semantic_query_from_tool(tool_name, tool_args)
        return _describe_semantic_query_validation_failure(raw_sq)

    expected_by_domain = {
        "profile": "show_personal_details",
        "account": "check_balance",
        "support": "contact_support",
    }
    if domain in expected_by_domain and expected_by_domain[domain] != intent:
        return f"domain/intent mismatch (domain={domain}, intent={intent}, expected={expected_by_domain[domain]})"

    return f"unsupported domain/intent combination (domain={domain}, intent={intent}, toolName={tool_name})"


def build_semantic_parser_prompt() -> str:
    current_date = get_current_date_for_prompt()
    return f"""
You are a banking intent router, not an answer generator.
Return only one strict JSON object. No markdown, no prose, no code fences.

Input payload fields:
- currentUserMessage is authoritative.
- currentUserMessage: the message to route.
- recentConversation: use only when currentUserMessage is a short incomplete follow-up.
- If currentUserMessage is a complete standalone banking request, ignore recentConversation for routing.
- currentDate: {current_date}; use it only for relative transaction date ranges.

Allowed intents:
- account/check_balance: current balance, available money, money in account, יתרה.
- profile/show_personal_details: stored user identity/profile details, name, email.
- transactions/recent_transactions: past transaction/transfer history, show/list/count/filter existing activity.
- transactions/transfer_money: start/continue/correct/confirm/cancel a new money transfer.
- support/contact_support: contact a representative, agent, support, video call.
- unknown/unknown: unsupported, casual, low-confidence, or genuinely ambiguous.

Required JSON schema:
{{"domain":"account|profile|transactions|support|unknown","intent":"check_balance|show_personal_details|recent_transactions|transfer_money|contact_support|unknown","confidence":0.0,"isAmbiguous":false,"ambiguityReason":null,"toolName":null,"semanticQuery":null,"transferPayload":null}}

Tool names:
- transfer_money must use toolName "open_money_transfer_inline".
- contact_support may use toolName "open_video_call_window".
- Other intents use toolName null.

Negative rules:
- "מה השם שלי" is never account/check_balance.
- "איך קוראים לי" is never account/check_balance.
- "תבצע לי העברה" is not balance. It starts transfer_money workflow.
- "אני רוצה להעביר כסף" is not balance. It starts transfer_money workflow.
- Balance questions are only about current balance / money in account / יתרה.
- Do not classify a standalone currentUserMessage as balance because recentConversation discussed balance.
- Do not classify a standalone currentUserMessage as transaction history because recentConversation discussed transactions.

Transaction history semanticQuery:
Use this shape for recent_transactions:
{{"domain":"transactions","intent":"transactions_query","action":"transfer_money|null","filters":{{"type":"transfer|null","direction":"outgoing|incoming|all|null"}},"timeRange":null,"dateRange":null,"aggregation":"list|first_n|count|counterparty","limit":null,"sortDirection":"desc|asc"}}
- Transfer history => action "transfer_money", filters.type "transfer".
- Sent/performed transfers ("שביצעתי", "ששלחתי") => direction "outgoing".
- Received transfers ("שקיבלתי", "נכנסות") => direction "incoming".
- Show/list without a number => aggregation "list".
- Latest/last/specific N rows => aggregation "first_n", limit N, sortDirection "desc".
- Count/how many => aggregation "count", limit null.
- If a date range is explicit, return dateRange as YYYY-MM-DD strings and keep timeRange null.

Transfer payload:
For a new transfer with missing details, use:
{{"receiverEmail":null,"amount":null,"description":null,"confirmation":null,"skipDescription":false,"startNewTransfer":true}}
Never invent receiverEmail, amount, description, or confirmation.

Examples:
User: "מה היתרה שלי?"
Output:
{{"domain":"account","intent":"check_balance","confidence":0.98,"isAmbiguous":false,"ambiguityReason":null,"toolName":null,"semanticQuery":null,"transferPayload":null}}

User: "כמה כסף יש לי בחשבון?"
Output:
{{"domain":"account","intent":"check_balance","confidence":0.98,"isAmbiguous":false,"ambiguityReason":null,"toolName":null,"semanticQuery":null,"transferPayload":null}}

User: "מה השם שלי?"
Output:
{{"domain":"profile","intent":"show_personal_details","confidence":0.98,"isAmbiguous":false,"ambiguityReason":null,"toolName":null,"semanticQuery":null,"transferPayload":null}}

User: "איך קוראים לי?"
Output:
{{"domain":"profile","intent":"show_personal_details","confidence":0.98,"isAmbiguous":false,"ambiguityReason":null,"toolName":null,"semanticQuery":null,"transferPayload":null}}

User: "תתקשר לנציג"
Output:
{{"domain":"support","intent":"contact_support","confidence":0.98,"isAmbiguous":false,"ambiguityReason":null,"toolName":"open_video_call_window","semanticQuery":null,"transferPayload":null}}

User: "תבצע לי העברה"
Output:
{{"domain":"transactions","intent":"transfer_money","confidence":0.98,"isAmbiguous":false,"ambiguityReason":null,"toolName":"open_money_transfer_inline","semanticQuery":null,"transferPayload":{{"receiverEmail":null,"amount":null,"description":null,"confirmation":null,"skipDescription":false,"startNewTransfer":true}}}}

User: "אני רוצה להעביר כסף"
Output:
{{"domain":"transactions","intent":"transfer_money","confidence":0.98,"isAmbiguous":false,"ambiguityReason":null,"toolName":"open_money_transfer_inline","semanticQuery":null,"transferPayload":{{"receiverEmail":null,"amount":null,"description":null,"confirmation":null,"skipDescription":false,"startNewTransfer":true}}}}

User: "תראה לי את ההעברות האחרונות"
Output:
{{"domain":"transactions","intent":"recent_transactions","confidence":0.95,"isAmbiguous":false,"ambiguityReason":null,"toolName":null,"semanticQuery":{{"domain":"transactions","intent":"transactions_query","action":"transfer_money","filters":{{"type":"transfer"}},"timeRange":null,"dateRange":null,"aggregation":"list","limit":null,"sortDirection":"desc"}},"transferPayload":null}}

User: "מה ההעברה האחרונה שביצעתי?"
Output:
{{"domain":"transactions","intent":"recent_transactions","confidence":0.95,"isAmbiguous":false,"ambiguityReason":null,"toolName":null,"semanticQuery":{{"domain":"transactions","intent":"transactions_query","action":"transfer_money","filters":{{"type":"transfer","direction":"outgoing"}},"timeRange":null,"dateRange":null,"aggregation":"first_n","limit":1,"sortDirection":"desc"}},"transferPayload":null}}

User: "כמה העברות ביצעתי החודש?"

Output:
{{"domain":"transactions","intent":"recent_transactions","confidence":0.95,"isAmbiguous":false,"ambiguityReason":null,"toolName":null,"semanticQuery":{{"domain":"transactions","intent":"transactions_query","action":"transfer_money","filters":{{"type":"transfer","direction":"outgoing"}},"timeRange":"this_month","dateRange":null,"aggregation":"count","limit":null,"sortDirection":"desc"}},"transferPayload":null}}

Confidence:
- If confidence is below 0.65, return unknown/unknown with confidence 0.
- If ambiguous between workflows, set isAmbiguous true, explain ambiguityReason briefly, and return unknown/unknown.
""".strip()


def _estimate_prompt_tokens(messages: list[dict]) -> int:
    # Cheap diagnostic estimate for comparing prompt size in logs/traces.
    char_count = sum(len(str(message.get("content") or "")) for message in messages)
    return max(1, round(char_count / 4))


async def parse_query_with_llm(*, user_input: str, history: list, create_chat_completion, abort_signal=None) -> dict | None:
    if not create_chat_completion:
        return None

    start = time.perf_counter()
    parser_span = None
    if ASSISTANT_DEBUG_ERRORS:
        sys.stderr.write("[LLM Parser] parse_query_with_llm start\n")
        sys.stderr.flush()

    try:
        system_prompt = build_semantic_parser_prompt()
        import json
        payload = build_user_prompt_payload(user_input=user_input, history=history)
        payload_json = json.dumps(payload, ensure_ascii=False)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": payload_json},
        ]
        prompt_chars = sum(len(message["content"]) for message in messages)
        prompt_token_estimate = _estimate_prompt_tokens(messages)
        current_message_preview = text_preview(user_input)
        parser_span = start_span(
            name="llm_semantic_parser",
            input=messages if capture_io_enabled() else {
                "currentUserMessage": current_message_preview,
                "recentConversationCount": len(payload.get("recentConversation") or []),
                "promptChars": prompt_chars,
                "promptTokenEstimate": prompt_token_estimate,
            },
            metadata={
                "model": ACTIVE_AI_MODEL,
                "response_format": "json_object",
                "temperature": 0,
                "top_p": 1,
                "recentConversationCount": len(payload.get("recentConversation") or []),
                "promptChars": prompt_chars,
                "promptTokenEstimate": prompt_token_estimate,
            },
        )
        trace_log(
            f"llm_semantic_parser requestId={get_request_id()} "
            f"currentUserMessage={current_message_preview.get('preview')!r} "
            f"prompt_chars={prompt_chars} prompt_tokens_est={prompt_token_estimate} model={ACTIVE_AI_MODEL}"
        )

        response = await create_chat_completion({
            "temperature": 0,
            "top_p": 1,
            "response_format": {"type": "json_object"},
            "messages": messages,
            "langfuse_name": "llm_semantic_parser.openai",
            "metadata": {
                "component": "semantic_parser",
                "currentUserMessage": current_message_preview,
                "recentConversationCount": len(payload.get("recentConversation") or []),
                "promptChars": prompt_chars,
                "promptTokenEstimate": prompt_token_estimate,
            },
        })

        raw_content = (response.choices[0].message.content or "") if response else ""
        parsed = json.loads(raw_content.strip())
        validated = validate_llm_semantic_parse(parsed)
        validation_reason = None
        if not validated:
            validation_reason = _describe_validation_failure(parsed)
            semantic_query = parsed.get("semanticQuery") if isinstance(parsed, dict) else None
            semantic_keys = list(semantic_query.keys()) if isinstance(semantic_query, dict) else []
            sys.stderr.write(
                "[LLM Parser] Validation failed: "
                f"reason={validation_reason} "
                f"domain={(parsed or {}).get('domain') if isinstance(parsed, dict) else None} "
                f"intent={(parsed or {}).get('intent') if isinstance(parsed, dict) else None} "
                f"semanticQueryKeys={semantic_keys}\n"
            )
            if ASSISTANT_DEBUG_ERRORS or capture_io_enabled():
                sys.stderr.write(f"[LLM Parser] Raw LLM JSON: {raw_content}\n")
            sys.stderr.flush()
            parser_span.end(
                output={
                    "raw": raw_content if capture_io_enabled() else text_preview(raw_content),
                    "parsed": parsed,
                    "validation": False,
                    "validationFailureReason": validation_reason,
                    "duration_ms": (time.perf_counter() - start) * 1000,
                },
                metadata={
                    "validation": False,
                    "validationFailureReason": validation_reason,
                    "promptChars": prompt_chars,
                    "promptTokenEstimate": prompt_token_estimate,
                },
            )
            record_event(
                name="validation_failed",
                metadata={
                    "selectedDomain": (parsed or {}).get("domain") if isinstance(parsed, dict) else None,
                    "selectedIntent": (parsed or {}).get("intent") if isinstance(parsed, dict) else None,
                    "confidence": (parsed or {}).get("confidence") if isinstance(parsed, dict) else None,
                    "reason": validation_reason,
                    "component": "llm_semantic_parser",
                    "duration_ms": (time.perf_counter() - start) * 1000,
                },
            )
            trace_log(
                f"llm_semantic_parser requestId={get_request_id()} "
                f"ms={(time.perf_counter() - start) * 1000:.1f} validation=false "
                f"parsed_domain={(parsed or {}).get('domain') if isinstance(parsed, dict) else None} "
                f"parsed_intent={(parsed or {}).get('intent') if isinstance(parsed, dict) else None} "
                f"prompt_tokens_est={prompt_token_estimate} model={ACTIVE_AI_MODEL}"
            )
            return None
        parser_span.end(
            output={
                "raw": raw_content if capture_io_enabled() else text_preview(raw_content),
                "parsed": parsed,
                "validated": {
                    "domain": validated.get("domain"),
                    "intent": validated.get("intent"),
                    "confidence": validated.get("confidence"),
                    "hasSemanticQuery": bool(validated.get("semanticQuery")),
                },
                "validation": True,
                "duration_ms": (time.perf_counter() - start) * 1000,
            },
            metadata={
                "validation": True,
                "domain": validated.get("domain"),
                "intent": validated.get("intent"),
                "confidence": validated.get("confidence"),
                "promptChars": prompt_chars,
                "promptTokenEstimate": prompt_token_estimate,
            },
        )
        trace_log(
            f"llm_semantic_parser requestId={get_request_id()} "
            f"ms={(time.perf_counter() - start) * 1000:.1f} validation=true "
            f"parsed_domain={validated.get('domain')} parsed_intent={validated.get('intent')} "
            f"prompt_tokens_est={prompt_token_estimate} model={ACTIVE_AI_MODEL}"
        )
        return validated
    except asyncio.CancelledError:
        if parser_span:
            parser_span.end(output={"cancelled": True}, metadata={"cancelled": True})
        raise
    except Exception as err:
        sys.stderr.write(f"[LLM Parser] Error: {err}\n")
        sys.stderr.flush()
        try:
            if parser_span:
                parser_span.end(output={"error": str(err)}, metadata={"error": str(err)})
        except Exception:
            pass
        return None
    finally:
        if ASSISTANT_DEBUG_ERRORS:
            duration_ms = (time.perf_counter() - start) * 1000
            sys.stderr.write(f"[LLM Parser] parse_query_with_llm end duration_ms={duration_ms:.1f}\n")
            sys.stderr.flush()
