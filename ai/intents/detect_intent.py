"""
Intent detection — port of detectIntent.js.
"""

from ai.intents.llm_semantic_parser import parse_query_with_llm
from ai.contracts.intent_result_contract import create_intent_result, create_unknown_intent, normalize_intent_result

_LLM_UNAVAILABLE = create_unknown_intent(source="llm_unavailable")
_LLM_PARSE_FAILED = create_unknown_intent(source="llm_parse_failed")


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
    final_parse = normalize_intent_result(
        parsed or (_LLM_PARSE_FAILED if create_chat_completion else _LLM_UNAVAILABLE)
    )

    return create_intent_result(
        **{k: v for k, v in final_parse.items() if k not in ("semanticQuery", "source")},
        source=final_parse.get("source", "safe_unknown"),
        semantic_query=final_parse.get("semanticQuery"),
    )
