"""
Banking state for LangGraph — Python port of bankingState.js.
Uses TypedDict for LangGraph state annotations.
"""

from typing import Any, Optional
from langgraph.graph import StateGraph
from typing_extensions import TypedDict


class BankingState(TypedDict, total=False):
    userInput: Any
    history: Any
    userId: Any
    session: Any
    isolation: Any
    intent: Any
    workflow: Any
    transfer: Any
    transactions: Any
    balance: Any
    support: Any
    personalDetails: Any
    risk: Any
    execution: Any
    workflowResponse: Any
    ui: Any
    audit: Any


def create_initial_banking_state(
    *,
    user_input: str,
    history: list = None,
    user_id: str,
    user_email: str = None,
    user_language: str = "en",
    transfer_state: dict = None,
    transfer_payload: dict = None,
) -> dict:
    from ai.contracts.assistant_response_contract import create_empty_workflow_response
    from ai.contracts.intent_result_contract import create_unknown_intent

    return {
        "userInput": user_input,
        "history": history or [],
        "userId": user_id,
        "session": {
            "userId": user_id,
            "userEmail": user_email,
            "userLanguage": user_language,
            "flowLanguage": (transfer_state or {}).get("flowLanguage") or user_language,
        },
        "isolation": {"userInput": user_input, "userId": user_id, "userLanguage": user_language},
        "intent": {
            **create_unknown_intent(),
            "detectedIntent": "unknown",
            "transferPayload": transfer_payload,
        },
        "workflow": {
            "activeWorkflow": "unknown",
            "currentPhase": "User Request",
            "cancelled": False,
        },
        "transfer": _create_transfer_state(transfer_state),
        "transactions": {"filters": None, "dateRange": None, "transactionType": None},
        "balance": {"currentBalance": None, "accountSummary": None},
        "support": {"ticketId": None},
        "personalDetails": {"userProfile": None},
        "risk": {"level": None, "triggeredRules": [], "requiresApproval": False},
        "execution": {"executed": False, "operation": None, "result": None},
        "workflowResponse": create_empty_workflow_response(),
        "ui": {"message": "", "form": None, "suggestions": [], "action": None},
        "audit": {"transitions": [], "aiDecisions": []},
    }


def _create_transfer_state(transfer_state: dict | None) -> dict:
    ts = transfer_state or {}
    return {
        "nextTransferState": transfer_state,
        "receiverEmail": ts.get("receiverEmail", ""),
        "amount": ts.get("amount"),
        "description": ts.get("description", ""),
        "confirmationRequired": bool(ts.get("riskConfirmationAsked")),
        "phase": ts.get("phase", "idle"),
        "lastValidationError": ts.get("lastValidationError"),
    }
