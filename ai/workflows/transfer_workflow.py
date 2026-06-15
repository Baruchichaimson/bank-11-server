"""
Transfer workflow — port of transferWorkflow.js (the outer one).
"""

from ai.workflows.transfer.transfer_state_machine import run_transfer_state_machine, build_next_transfer_state
from ai.assistant.response_wrappers import get_window_tool_action, get_window_tool_reply
from ai.contracts.assistant_response_contract import create_executed_workflow_response, create_workflow_response


async def run_transfer_workflow(
    *, state: dict, services: dict, create_chat_completion=None, abort_signal=None
) -> dict:
    session = state.get("session") or {}
    intent = state.get("intent") or {}
    transfer = state.get("transfer") or {}

    result = await run_transfer_state_machine(
        user_input=state.get("userInput", ""),
        user_language=session.get("userLanguage", "en"),
        user_id=session.get("userId"),
        transfer_state=transfer.get("nextTransferState"),
        semantic_intent=intent.get("intent") or intent.get("detectedIntent") or "unknown",
        transfer_payload=intent.get("transferPayload"),
        correction=intent.get("correction"),
        services=services,
        create_chat_completion=create_chat_completion,
        abort_signal=abort_signal,
    )

    next_transfer_state = build_next_transfer_state(result)
    phase = (next_transfer_state or {}).get("phase", "idle")
    active_workflow = "transfer_workflow" if phase and phase != "idle" else "unknown"

    if not result.get("handled"):
        form_result = await (services or {}).get("transactionService").open_transfer_form(
            user_id=session.get("userId")
        )
        reply = get_window_tool_reply("open_money_transfer_inline", session.get("userLanguage", "en"))
        action = get_window_tool_action("open_money_transfer_inline", form_result)
        workflow_response = create_executed_workflow_response(
            message=reply,
            action=action,
            operation="open_money_transfer_inline",
            result=form_result,
        )
        return {
            **state,
            "workflow": {**(state.get("workflow") or {}), "activeWorkflow": active_workflow, "currentPhase": "Return Response with Suggestions"},
            "execution": workflow_response["execution"],
            "workflowResponse": workflow_response,
            "ui": {**(state.get("ui") or {}), "message": reply, "action": action},
        }

    workflow_response = create_workflow_response(
        message=result.get("reply", ""),
        action=result.get("action"),
        next_conversation_state=next_transfer_state,
        execution={
            "executed": bool(result.get("handled")),
            "operation": "transfer_money",
            "result": result,
        },
    )

    return {
        **state,
        "workflow": {**(state.get("workflow") or {}), "activeWorkflow": active_workflow, "currentPhase": "Return Response with Suggestions"},
        "transfer": {
            **(state.get("transfer") or {}),
            "receiverEmail": (next_transfer_state or {}).get("receiverEmail", ""),
            "amount": (next_transfer_state or {}).get("amount"),
            "description": (next_transfer_state or {}).get("description", ""),
            "confirmationRequired": bool((next_transfer_state or {}).get("riskConfirmationAsked")),
            "phase": (next_transfer_state or {}).get("phase", "idle"),
            "lastValidationError": (next_transfer_state or {}).get("lastValidationError"),
            "nextTransferState": next_transfer_state,
        },
        "execution": workflow_response["execution"],
        "workflowResponse": workflow_response,
        "ui": {
            **(state.get("ui") or {}),
            "message": workflow_response["message"],
            "action": result.get("action"),
        },
    }
