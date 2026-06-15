from ai.contracts.assistant_response_contract import create_executed_workflow_response, create_workflow_response
from ai.assistant.response_wrappers import get_window_tool_action, get_window_tool_reply


async def run_support_workflow(*, state: dict, services: dict) -> dict:
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

    return {
        **state,
        "workflow": {**(state.get("workflow") or {}), "currentPhase": "Return Response with Suggestions"},
        "workflowResponse": final_response,
        "ui": {**(state.get("ui") or {}), "message": message},
    }
