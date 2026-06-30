"""
Intent detection — port of detectIntent.js.
"""

from ai.intents.llm_semantic_parser import parse_query_with_llm
from ai.intents.casual_phrase_guard import guard_intent_routing
from ai.intents.transaction_history_guard import detect_transaction_history_intent
from ai.contracts.intent_result_contract import create_intent_result, create_unknown_intent, normalize_intent_result
from observability.langfuse_tracing import (
    duration_ms,
    get_request_id,
    now_ms,
    record_event,
    start_span,
    text_preview,
    trace_log,
    update_trace_fields,
)

_LLM_UNAVAILABLE = create_unknown_intent(source="llm_unavailable")
_LLM_PARSE_FAILED = create_unknown_intent(source="llm_parse_failed")


async def detect_intent(
    *,
    user_input: str,
    history: list = None,
    create_chat_completion=None,
    abort_signal=None,
) -> dict:
    start = now_ms()
    span = start_span(
        name="detect_intent",
        input={"user_input": text_preview(user_input), "history_count": len(history or [])},
        metadata={"create_chat_completion_present": bool(create_chat_completion)},
    )
    parsed = None
    final_parse = None
    try:
        guarded = guard_intent_routing(user_input=user_input)
        if guarded is not None:
            final_parse = normalize_intent_result(guarded)
        else:
            history_intent = detect_transaction_history_intent(user_input)
            if history_intent is not None:
                final_parse = normalize_intent_result(history_intent)
            else:
                parsed = await parse_query_with_llm(
                    user_input=user_input,
                    history=history or [],
                    create_chat_completion=create_chat_completion,
                    abort_signal=abort_signal,
                )
                final_parse = normalize_intent_result(
                    parsed or (_LLM_PARSE_FAILED if create_chat_completion else _LLM_UNAVAILABLE)
                )
                override = guard_intent_routing(user_input=user_input, parsed=final_parse)
                if override is not None:
                    final_parse = normalize_intent_result(override)

        result = create_intent_result(
            **{k: v for k, v in final_parse.items() if k not in ("semanticQuery", "source")},
            source=final_parse.get("source", "safe_unknown"),
            semantic_query=final_parse.get("semanticQuery"),
        )
        ms = duration_ms(start)
        output = {
            "parsed_domain": (parsed or {}).get("domain"),
            "parsed_intent": (parsed or {}).get("intent"),
            "parsed_confidence": (parsed or {}).get("confidence"),
            "final_domain": result.get("domain"),
            "final_intent": result.get("intent"),
            "final_confidence": result.get("confidence"),
            "final_source": result.get("source"),
            "has_semantic_query": bool(result.get("semanticQuery")),
            "duration_ms": ms,
        }
        span.end(output=output, metadata=output)
        update_trace_fields(
            selected_domain=result.get("domain"),
            selected_intent=result.get("intent"),
            intent_source=result.get("source"),
            intent_confidence=result.get("confidence"),
        )
        tool = result.get("tool") if isinstance(result.get("tool"), dict) else {}
        record_event(
            name="intent_detected",
            metadata={
                "selectedDomain": result.get("domain"),
                "selectedIntent": result.get("intent"),
                "confidence": result.get("confidence"),
                "toolName": tool.get("name"),
                "source": result.get("source"),
                "hasSemanticQuery": bool(result.get("semanticQuery")),
                "duration_ms": ms,
            },
        )
        trace_log(
            f"detect_intent requestId={get_request_id()} ms={ms:.1f} "
            f"domain={result.get('domain')} intent={result.get('intent')}"
        )
        return result
    except Exception as err:
        span.end(output={"error": str(err)}, metadata={"error": str(err)})
        raise
