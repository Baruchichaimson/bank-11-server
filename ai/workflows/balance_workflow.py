from ai.contracts.assistant_response_contract import create_executed_workflow_response, create_workflow_response
from ai.assistant.response_formatting import format_financial_response


async def run_balance_workflow(*, state: dict, services: dict) -> dict:
    account_service = (services or {}).get("accountService")
    result = await account_service.get_balance(user_id=state["session"]["userId"])

    workflow_response = create_executed_workflow_response(operation="get_balance", result=result)

    state = {
        **state,
        "workflow": {**(state.get("workflow") or {}), "activeWorkflow": "unknown", "currentPhase": "Evaluate Account"},
        "balance": {**(state.get("balance") or {}), "currentBalance": result.get("balance"), "accountSummary": result},
        "execution": workflow_response["execution"],
        "workflowResponse": workflow_response,
        "ui": {**(state.get("ui") or {}), "message": ""},
    }

    message = format_financial_response("get_balance", state["execution"]["result"], state["session"]["userLanguage"])
    final_response = create_workflow_response(**{**workflow_response, "message": message})

    return {
        **state,
        "workflow": {**(state.get("workflow") or {}), "currentPhase": "Return Response with Suggestions"},
        "workflowResponse": final_response,
        "ui": {**(state.get("ui") or {}), "message": message},
    }
