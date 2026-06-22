from ai.contracts.assistant_response_contract import create_empty_workflow_response
from ai.assistant.shared import get_llm_unavailable_reply, get_llm_parse_failed_reply
from observability.langfuse_tracing import record_event


def _get_unknown_intent_reply(user_language: str) -> str:
    if user_language == "he":
        return (
            "אני עוזר בנקאי בלבד, ולכן אני לא יכול לענות על שאלות מסוג זה. "
            "אפשר לבקש ממני יתרה, פירוט פעולות או העברות, פרטים אישיים, שיחת וידאו עם נציג או ביצוע העברה."
        )
    return (
        "I am only a banking assistant, so I cannot answer this type of request. "
        "You can ask for your balance, transaction or transfer details, personal details, "
        "a video call with a representative, or a money transfer."
    )


def _generate_unknown_reply(*, state: dict) -> str:
    user_language = (state.get("session") or {}).get("userLanguage", "en")
    source = (state.get("intent") or {}).get("source", "")
    if source == "llm_unavailable":
        return get_llm_unavailable_reply(user_language)
    if source == "llm_parse_failed":
        return get_llm_parse_failed_reply(user_language)
    return _get_unknown_intent_reply(user_language)


async def run_unknown_workflow(*, state: dict) -> dict:
    source = (state.get("intent") or {}).get("source", "")
    if source in {"llm_unavailable", "llm_parse_failed"}:
        record_event(
            name="fallback_used",
            metadata={
                "selectedWorkflow": "unknown_workflow",
                "reason": source,
            },
        )
    message = _generate_unknown_reply(state=state)
    workflow_response = create_empty_workflow_response(message=message)

    return {
        **state,
        "workflow": {**(state.get("workflow") or {}), "activeWorkflow": "unknown", "currentPhase": "Return Response with Suggestions"},
        "execution": workflow_response["execution"],
        "workflowResponse": workflow_response,
        "ui": {**(state.get("ui") or {}), "message": message, "suggestions": []},
    }
