from ai.contracts.assistant_response_contract import create_executed_workflow_response, create_workflow_response
from ai.assistant.response_wrappers import get_window_tool_action, get_window_tool_reply
from observability.langfuse_tracing import duration_ms, get_request_id, now_ms, start_span, trace_log


async def run_support_workflow(*, state: dict, services: dict) -> dict:
    start = now_ms()
    span = start_span(name="support_workflow", metadata={"workflow_name": "support_workflow"})
    support_service = (services or {}).get("supportService")
    user_language = (state.get("session") or {}).get("userLanguage", "en")

    result = await support_service.connect_representative(user_id=(state.get("session") or {}).get("userId"))
    action = get_window_tool_action("open_video_call_window", result)

    workflow_response = create_executed_workflow_response(
        action=action,
        operation="open_video_call_window",
        result=result,
    )

    state = {
        **state,
        "workflow": {**(state.get("workflow") or {}), "activeWorkflow": "unknown", "currentPhase": "Leverage Data"},
        "support": {**(state.get("support") or {}), "ticketId": result.get("ticketId")},
        "execution": workflow_response["execution"],
        "workflowResponse": workflow_response,
        "ui": {**(state.get("ui") or {}), "action": action},
    }

    message = get_window_tool_reply("open_video_call_window", user_language)
    final_response = create_workflow_response(**{**workflow_response, "message": message})

    output = {
        **state,
        "workflow": {**(state.get("workflow") or {}), "currentPhase": "Return Response with Suggestions"},
        "workflowResponse": final_response,
        "ui": {**(state.get("ui") or {}), "message": message},
    }
    ms = duration_ms(start)
    action_type = action.get("type") if isinstance(action, dict) else action
    summary = {
        "workflow_name": "support_workflow",
        "operation": "open_video_call_window",
        "duration_ms": ms,
        "action_type": action_type,
        "status": result.get("status") if isinstance(result, dict) else None,
    }
    span.end(output=summary, metadata=summary)
    trace_log(f"workflow requestId={get_request_id()} name=support_workflow ms={ms:.1f}")
    return output
