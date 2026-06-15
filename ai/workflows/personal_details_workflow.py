from ai.contracts.assistant_response_contract import create_executed_workflow_response, create_workflow_response
from ai.assistant.response_formatting import format_financial_response


async def run_personal_details_workflow(*, state: dict, services: dict) -> dict:
    profile_service = (services or {}).get("profileService")
    user_language = (state.get("session") or {}).get("userLanguage", "en")

    result = await profile_service.get_user_profile(user_id=(state.get("session") or {}).get("userId"))
    workflow_response = create_executed_workflow_response(operation="get_user_identity", result=result)

    state = {
        **state,
        "workflow": {**(state.get("workflow") or {}), "activeWorkflow": "unknown", "currentPhase": "Leverage Data"},
        "personalDetails": {**(state.get("personalDetails") or {}), "userProfile": result},
        "execution": workflow_response["execution"],
        "workflowResponse": workflow_response,
        "ui": {**(state.get("ui") or {}), "message": ""},
    }

    message = format_financial_response("get_user_identity", state["execution"]["result"], user_language)
    final_response = create_workflow_response(**{**workflow_response, "message": message})

    return {
        **state,
        "workflow": {**(state.get("workflow") or {}), "currentPhase": "Return Response with Suggestions"},
        "workflowResponse": final_response,
        "ui": {**(state.get("ui") or {}), "message": message},
    }
