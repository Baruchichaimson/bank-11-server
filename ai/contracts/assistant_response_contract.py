from ai.shared.json_safe import make_json_safe


def _is_plain_object(value) -> bool:
    return value is not None and isinstance(value, dict)


def _normalize_action(action):
    if not action:
        return None
    if isinstance(action, str):
        return {"type": action}
    if not _is_plain_object(action) or not isinstance(action.get("type"), str) or not action["type"].strip():
        return None
    normalized = {"type": action["type"]}
    payload = action.get("payload")
    rest = {k: v for k, v in action.items() if k not in ("type", "payload")}
    if _is_plain_object(payload):
        normalized["payload"] = make_json_safe(payload)
    elif rest:
        normalized["payload"] = make_json_safe(rest)
    return normalized


def _normalize_execution(execution: dict) -> dict:
    execution = execution or {}
    return {
        "executed": bool(execution.get("executed")),
        "operation": execution.get("operation"),
        "result": make_json_safe(execution.get("result")) if _is_plain_object(execution.get("result")) else None,
    }


def create_workflow_response(
    *,
    message="",
    action=None,
    next_conversation_state=None,
    nextConversationState=None,
    execution=None,
) -> dict:
    next_conversation_state = (
        next_conversation_state
        if next_conversation_state is not None
        else nextConversationState
    )
    return {
        "message": str(message or ""),
        "action": _normalize_action(action),
        "nextConversationState": make_json_safe(next_conversation_state) if _is_plain_object(next_conversation_state) else None,
        "execution": _normalize_execution(execution or {}),
    }


def create_executed_workflow_response(
    *,
    message="",
    action=None,
    next_conversation_state=None,
    nextConversationState=None,
    operation=None,
    result=None,
) -> dict:
    next_conversation_state = (
        next_conversation_state
        if next_conversation_state is not None
        else nextConversationState
    )
    return create_workflow_response(
        message=message,
        action=action,
        next_conversation_state=next_conversation_state,
        execution={"executed": True, "operation": operation, "result": result},
    )


def create_empty_workflow_response(
    *,
    message="",
    action=None,
    next_conversation_state=None,
    nextConversationState=None,
    operation=None,
    result=None,
) -> dict:
    next_conversation_state = (
        next_conversation_state
        if next_conversation_state is not None
        else nextConversationState
    )
    return create_workflow_response(
        message=message,
        action=action,
        next_conversation_state=next_conversation_state,
        execution={"executed": False, "operation": operation, "result": result},
    )


def normalize_workflow_response(response=None) -> dict:
    if not response:
        return create_empty_workflow_response()
    if isinstance(response, dict) and response.get("workflowResponse"):
        return normalize_workflow_response(response["workflowResponse"])
    execution = response.get("execution") or {}
    message = (
        response.get("message")
        or response.get("reply")
        or (response.get("ui") or {}).get("message")
        or ""
    )
    action = (
        response.get("action")
        or (response.get("ui") or {}).get("action")
    )
    next_state = (
        response.get("nextConversationState")
        or response.get("nextTransferState")
        or (response.get("transfer") or {}).get("nextTransferState")
    )
    return create_workflow_response(
        message=message,
        action=action,
        next_conversation_state=next_state,
        execution={
            "executed": execution.get("executed"),
            "operation": execution.get("operation"),
            "result": execution.get("result"),
        },
    )
