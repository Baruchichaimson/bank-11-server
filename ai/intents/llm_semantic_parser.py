"""
LLM semantic parser — port of llmSemanticParser.js.
"""

import json
import re
from ai.intents.semantic_catalog import ALLOWED_DOMAINS, ALLOWED_INTENTS, ALLOWED_TOOL_NAMES, TOOL_BY_NAME, ALLOWED_AGGREGATIONS
from ai.intents.llm_prompt_payload_builder import build_user_prompt_payload, get_current_date_for_prompt
from ai.contracts.intent_result_contract import create_intent_result, create_ambiguous_intent

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


def _validate_semantic_query(raw) -> dict | None:
    if not raw or not isinstance(raw, dict):
        return None
    domain = raw.get("domain")
    intent = raw.get("intent")
    if domain != "transactions" or intent != "transactions_query":
        return None
    aggregation = raw.get("aggregation")
    if aggregation not in ALLOWED_AGGREGATIONS:
        return None
    return raw


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


def build_semantic_parser_prompt() -> str:
    from ai.intents.llm_prompt_payload_builder import get_current_date_for_prompt
    current_date = get_current_date_for_prompt()
    return f"""
You are a conversation-aware semantic banking intent classifier.

Your job is not to answer the user.
Your job is to convert the current user message into one strict JSON routing object.
Use recent conversation context only to resolve short follow-up messages.

Return ONLY valid JSON. No markdown. No explanations. No comments.

Response contract: domains={ALLOWED_DOMAINS}, intents={ALLOWED_INTENTS}

Core routing:
- classify by the meaning of the requested action, not by keyword overlap.
- balance/current money => domain account, intent check_balance
- past activity/history/list/count/filter existing transactions => domain transactions, intent recent_transactions
- starting/confirming/correcting/canceling a new transfer => domain transactions, intent transfer_money
- stored user identity/profile details => domain profile, intent show_personal_details
- representative/support/video call => domain support, intent contact_support
- Hebrew: "תתקשר לנציג", "אני רוצה לדבר עם נציג" => domain support, intent contact_support
- unsupported, casual, or ambiguous input => domain unknown, intent unknown

Transaction history parameter extraction:
- Always return semanticQuery for recent_transactions
- semanticQuery.domain="transactions", semanticQuery.intent="transactions_query"
- Questions asking how many/count => aggregation="count", limit=null
- Questions asking for N rows => aggregation="first_n", limit=N
- Questions asking to show/list => aggregation="list"
- Transfer history: action="transfer_money", filters.type="transfer"
- Sent transfers: filters.direction="outgoing"; received: filters.direction="incoming"
- Date extraction: dateRange as {{"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}} using currentDate={current_date}
- חודש שעבר/last month => previous full calendar month
- החודש/this month => first day of current month through currentDate

Safety and confidence:
- Extract only values explicitly present or clearly implied
- Never invent transfer recipient, amount, description, dates, or confirmation
- If confidence < 0.65, return unknown
- If ambiguous, set isAmbiguous=true

Return valid JSON only.
""".strip()


async def parse_query_with_llm(*, user_input: str, history: list, create_chat_completion, abort_signal=None) -> dict | None:
    if not create_chat_completion:
        return None

    try:
        system_prompt = build_semantic_parser_prompt()
        import json
        payload = build_user_prompt_payload(user_input=user_input, history=history)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(payload)},
        ]

        response = await create_chat_completion({
            "temperature": 0,
            "top_p": 1,
            "response_format": {"type": "json_object"},
            "messages": messages,
        })

        raw_content = (response.choices[0].message.content or "") if response else ""
        parsed = json.loads(raw_content.strip())
        validated = validate_llm_semantic_parse(parsed)
        if not validated:
            print(f"[LLM Parser] Validation failed for: {raw_content[:200]}")
            return None
        return validated
    except Exception as err:
        print(f"[LLM Parser] Error: {err}")
        return None
