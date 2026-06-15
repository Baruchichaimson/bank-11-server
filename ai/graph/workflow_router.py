INTENT_TO_WORKFLOW = {
    "show_personal_details": "personal_details_workflow",
    "check_balance": "balance_workflow",
    "recent_transactions": "transactions_workflow",
    "contact_support": "support_workflow",
    "transfer_money": "transfer_workflow",
}


def route_workflow_by_intent(intent: str) -> str:
    return INTENT_TO_WORKFLOW.get(intent, "unknown_workflow")


def route_workflow(*, intent: str, domain: str = None) -> str:
    return route_workflow_by_intent(intent)
