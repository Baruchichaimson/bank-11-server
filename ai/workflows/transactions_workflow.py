from ai.contracts.assistant_response_contract import create_empty_workflow_response, create_executed_workflow_response
from ai.assistant.shared import get_llm_parse_failed_reply
from ai.assistant.response_formatting import format_financial_response
from observability.langfuse_tracing import duration_ms, get_request_id, now_ms, record_event, start_span, trace_log


async def run_transactions_workflow(*, state: dict, services: dict) -> dict:
    start = now_ms()
    span = start_span(name="transactions_workflow", metadata={"workflow_name": "transactions_workflow"})
    transaction_service = (services or {}).get("transactionService")
    semantic_query = (state.get("intent") or {}).get("semanticQuery")
    user_language = (state.get("session") or {}).get("userLanguage", "en")

    if not semantic_query:
        intent = state.get("intent") or {}
        record_event(
            name="validation_failed",
            metadata={
                "selectedDomain": intent.get("domain"),
                "selectedIntent": intent.get("intent"),
                "selectedWorkflow": "transactions_workflow",
                "reason": "missing_semantic_query",
            },
        )
        record_event(
            name="fallback_used",
            metadata={
                "selectedWorkflow": "transactions_workflow",
                "reason": "missing_semantic_query",
            },
        )
        workflow_response = create_empty_workflow_response(message=get_llm_parse_failed_reply(user_language))
        output = {
            **state,
            "workflow": {**(state.get("workflow") or {}), "activeWorkflow": "unknown", "currentPhase": "Return Response with Suggestions"},
            "execution": workflow_response["execution"],
            "workflowResponse": workflow_response,
            "ui": {**(state.get("ui") or {}), "message": workflow_response["message"], "suggestions": []},
        }
        ms = duration_ms(start)
        span.end(output={"workflow_name": "transactions_workflow", "duration_ms": ms, "semanticQuery": False}, metadata={"duration_ms": ms, "semanticQuery": False})
        trace_log(f"workflow requestId={get_request_id()} name=transactions_workflow ms={ms:.1f}")
        return output

    result_obj = await transaction_service.execute_structured_query(
        user_id=(state.get("session") or {}).get("userId"),
        user_email=(state.get("session") or {}).get("userEmail"),
        query=semantic_query,
    )
    operation = result_obj.get("operation", "get_recent_transfers")
    result = result_obj.get("result")

    message = format_financial_response(operation, result, user_language)
    workflow_response = create_executed_workflow_response(message=message, operation=operation, result=result)

    output = {
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
    ms = duration_ms(start)
    summary = {
        "workflow_name": "transactions_workflow",
        "operation": operation,
        "duration_ms": ms,
        "aggregation": semantic_query.get("aggregation"),
        "filters": semantic_query.get("filters"),
        "count": result.get("count") if isinstance(result, dict) else None,
    }
    span.end(output=summary, metadata=summary)
    trace_log(f"workflow requestId={get_request_id()} name=transactions_workflow ms={ms:.1f}")
    return output
