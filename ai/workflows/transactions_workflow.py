from ai.contracts.assistant_response_contract import create_empty_workflow_response, create_executed_workflow_response
from ai.assistant.shared import get_llm_parse_failed_reply
from ai.assistant.response_formatting import format_financial_response


async def run_transactions_workflow(*, state: dict, services: dict) -> dict:
    transaction_service = (services or {}).get("transactionService")
    semantic_query = (state.get("intent") or {}).get("semanticQuery")
    user_language = (state.get("session") or {}).get("userLanguage", "en")

    if not semantic_query:
        workflow_response = create_empty_workflow_response(message=get_llm_parse_failed_reply(user_language))
        return {
            **state,
            "workflow": {**(state.get("workflow") or {}), "activeWorkflow": "unknown", "currentPhase": "Return Response with Suggestions"},
            "execution": workflow_response["execution"],
            "workflowResponse": workflow_response,
            "ui": {**(state.get("ui") or {}), "message": workflow_response["message"], "suggestions": []},
        }

    result_obj = await transaction_service.execute_structured_query(
        user_id=(state.get("session") or {}).get("userId"),
        user_email=(state.get("session") or {}).get("userEmail"),
        query=semantic_query,
    )
    operation = result_obj.get("operation", "get_recent_transfers")
    result = result_obj.get("result")

    message = format_financial_response(operation, result, user_language)
    workflow_response = create_executed_workflow_response(message=message, operation=operation, result=result)

    return {
        **state,
        "workflow": {**(state.get("workflow") or {}), "activeWorkflow": "unknown", "currentPhase": "Return Response with Suggestions"},
        "transactions": {
            **(state.get("transactions") or {}),
            "filters": semantic_query.get("filters"),
            "dateRange": semantic_query.get("dateRange"),
            "transactionType": semantic_query.get("action"),
        },
        "execution": workflow_response["execution"],
        "workflowResponse": workflow_response,
        "ui": {**(state.get("ui") or {}), "message": message, "suggestions": []},
    }
