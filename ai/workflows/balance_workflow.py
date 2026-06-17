from ai.contracts.assistant_response_contract import create_executed_workflow_response, create_workflow_response
from ai.assistant.response_formatting import format_financial_response
from observability.langfuse_tracing import capture_io_enabled, duration_ms, get_request_id, now_ms, start_span, trace_log


async def run_balance_workflow(*, state: dict, services: dict) -> dict:
    start = now_ms()
    span = start_span(name="balance_workflow", metadata={"workflow_name": "balance_workflow"})
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

    output = {
        **state,
        "workflow": {**(state.get("workflow") or {}), "currentPhase": "Return Response with Suggestions"},
        "workflowResponse": final_response,
        "ui": {**(state.get("ui") or {}), "message": message},
    }
    ms = duration_ms(start)
    summary = {
        "workflow_name": "balance_workflow",
        "operation": "get_balance",
        "duration_ms": ms,
        "found": result.get("found"),
        "currency": result.get("currency"),
        "status": result.get("status"),
        **({"balance": result.get("balance")} if capture_io_enabled() else {}),
    }
    span.end(output=summary, metadata=summary)
    trace_log(f"workflow requestId={get_request_id()} name=balance_workflow ms={ms:.1f}")
    return output
