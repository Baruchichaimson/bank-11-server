"""
Banking LangGraph — Python port of bankingGraph.js.
Uses langgraph StateGraph with BankingState TypedDict.
"""

from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
import time
from ai.graph.banking_state import BankingState, create_initial_banking_state
from ai.graph.workflow_router import route_workflow
from ai.intents.detect_intent import detect_intent
from ai.contracts.assistant_response_contract import normalize_workflow_response
from ai.assistant.shared import detect_language, create_reply_payload
from ai.shared.json_safe import make_json_safe
from config.settings import BANKING_GRAPH_DEBUG
from observability.langfuse_tracing import (
    get_request_id,
    get_trace_fields,
    record_event,
    start_span,
    text_preview,
    trace_log,
    update_trace_fields,
)


def _debug(*args):
    if BANKING_GRAPH_DEBUG:
        print(*args)


def _to_client_action(action):
    if not action:
        return None
    if isinstance(action, str):
        return action
    if action.get("type") == "open_video_call" and not action.get("payload"):
        return "open_video_call"
    if action.get("payload"):
        return {"type": action["type"], **action["payload"]}
    return {k: v for k, v in action.items() if k != "payload"}


def _action_type(action):
    return action.get("type") if isinstance(action, dict) else action


def _transfer_state_for_interrupt(interrupt_value: dict) -> dict:
    interrupt_type = (interrupt_value or {}).get("type")
    phase = "await_confirmation" if interrupt_type in {"high_amount_confirm", "confirm_transfer"} else "form_open"
    return {"phase": phase}


def _extract_interrupt_value(*, final_state=None, state_snapshot=None) -> dict:
    if isinstance(final_state, dict):
        for intr in final_state.get("__interrupt__") or []:
            return getattr(intr, "value", None) or {}

    for task in (getattr(state_snapshot, "tasks", None) or []):
        for intr in (getattr(task, "interrupts", None) or []):
            return getattr(intr, "value", None) or {}

    return {}


async def user_request_node(state: dict) -> dict:
    return make_json_safe({
        **state,
        "workflow": {**(state.get("workflow") or {}), "currentPhase": "User Request"},
        "audit": {
            **(state.get("audit") or {}),
            "transitions": [*((state.get("audit") or {}).get("transitions") or []), "User Request"],
        },
    })


async def find_intent_node(state: dict, config: RunnableConfig | None = None) -> dict:
    configurable = (config or {}).get("configurable") or {}
    span = start_span(
        name="find_intent_node",
        input={"userInput": text_preview(state.get("userInput", ""))},
        metadata={"history_count": len(state.get("history") or [])},
    )

    detection = await detect_intent(
        user_input=state.get("userInput", ""),
        history=state.get("history") or [],
        create_chat_completion=configurable.get("createChatCompletion"),
        abort_signal=configurable.get("abortSignal"),
    )
    detection["detectedIntent"] = detection["intent"]
    _debug("BANKING GRAPH DETECTED INTENT", detection.get("intent"), detection.get("source"))
    output = {
        "domain": detection.get("domain"),
        "intent": detection.get("intent"),
        "detectedIntent": detection.get("detectedIntent"),
        "confidence": detection.get("confidence"),
        "source": detection.get("source"),
    }
    span.end(output=output, metadata=output)

    return make_json_safe({
        **state,
        "intent": detection,
        "audit": {
            **(state.get("audit") or {}),
            "transitions": [*((state.get("audit") or {}).get("transitions") or []), f"Intent: {detection['intent']}"],
        },
    })


async def workflow_router_node(state: dict) -> dict:
    intent = state.get("intent") or {}
    before = {
        "state.intent.domain": intent.get("domain"),
        "state.intent.intent": intent.get("intent"),
        "state.intent.detectedIntent": intent.get("detectedIntent"),
        "state.intent.source": intent.get("source"),
        "state.intent.confidence": intent.get("confidence"),
    }
    span = start_span(name="workflow_router_node", input=before, metadata=before)
    workflow = route_workflow(
        intent=intent.get("intent") or intent.get("detectedIntent") or "unknown",
        domain=intent.get("domain"),
    )
    _debug("BANKING GRAPH SELECTED WORKFLOW", workflow)
    span.end(output={"selected_workflow": workflow}, metadata={**before, "selected_workflow": workflow})
    update_trace_fields(selected_workflow=workflow)
    record_event(
        name="workflow_selected",
        metadata={
            "selectedDomain": intent.get("domain"),
            "selectedIntent": intent.get("intent"),
            "selectedWorkflow": workflow,
            "confidence": intent.get("confidence"),
            "source": intent.get("source"),
        },
    )
    trace_log(f"workflow_router requestId={get_request_id()} workflow={workflow}")
    return make_json_safe({
        **state,
        "workflow": {
            **(state.get("workflow") or {}),
            "activeWorkflow": workflow,
            "currentPhase": "Workflow Routing",
        },
        "audit": {
            **(state.get("audit") or {}),
            "transitions": [*((state.get("audit") or {}).get("transitions") or []), f"Workflow: {workflow}"],
        },
    })


def _get_services(config):
    return (config or {}).get("configurable", {}).get("services")


async def _run_workflow_with_trace(*, workflow_name: str, func, state: dict, config: RunnableConfig | None = None, services=None):
    start = time.perf_counter()
    span = start_span(
        name="workflow",
        input={"workflow_name": workflow_name},
        metadata={"workflow_name": workflow_name},
    )
    try:
        if services is not None:
            result = await func(state=state, services=services)
        else:
            result = await func(state=state, config=config)
        ms = (time.perf_counter() - start) * 1000
        workflow_response = (result or {}).get("workflowResponse") or {}
        execution = workflow_response.get("execution") or (result or {}).get("execution") or {}
        span.end(
            output={
                "workflow_name": workflow_name,
                "success": True,
                "operation": execution.get("operation"),
                "duration_ms": ms,
            },
            metadata={"workflow_name": workflow_name, "success": True, "operation": execution.get("operation"), "duration_ms": ms},
        )
        trace_log(f"workflow requestId={get_request_id()} name={workflow_name} ms={ms:.1f}")
        return result
    except Exception as err:
        ms = (time.perf_counter() - start) * 1000
        record_event(
            name="error_occurred",
            metadata={
                "selectedWorkflow": workflow_name,
                "error": str(err),
                "duration_ms": ms,
            },
        )
        span.end(
            output={"workflow_name": workflow_name, "success": False, "error": str(err), "duration_ms": ms},
            metadata={"workflow_name": workflow_name, "success": False, "error": str(err), "duration_ms": ms},
        )
        trace_log(f"workflow requestId={get_request_id()} name={workflow_name} ms={ms:.1f} error={err}")
        raise


async def run_transfer_workflow_node(state: dict, config: RunnableConfig | None = None) -> dict:
    from ai.workflows.transfer.transfer_state_machine import run_transfer_node
    return make_json_safe(await _run_workflow_with_trace(workflow_name="transfer_workflow", func=run_transfer_node, state=state, config=config))


async def run_transactions_workflow_node(state: dict, config: RunnableConfig | None = None) -> dict:
    from ai.workflows.transactions_workflow import run_transactions_workflow
    return make_json_safe(await _run_workflow_with_trace(workflow_name="transactions_workflow", func=run_transactions_workflow, state=state, services=_get_services(config)))


async def run_balance_workflow_node(state: dict, config: RunnableConfig | None = None) -> dict:
    from ai.workflows.balance_workflow import run_balance_workflow
    return make_json_safe(await _run_workflow_with_trace(workflow_name="balance_workflow", func=run_balance_workflow, state=state, services=_get_services(config)))


async def run_support_workflow_node(state: dict, config: RunnableConfig | None = None) -> dict:
    from ai.workflows.support_workflow import run_support_workflow
    return make_json_safe(await _run_workflow_with_trace(workflow_name="support_workflow", func=run_support_workflow, state=state, services=_get_services(config)))


async def run_personal_details_workflow_node(state: dict, config: RunnableConfig | None = None) -> dict:
    from ai.workflows.personal_details_workflow import run_personal_details_workflow
    return make_json_safe(await _run_workflow_with_trace(workflow_name="personal_details_workflow", func=run_personal_details_workflow, state=state, services=_get_services(config)))


async def run_unknown_workflow_node(state: dict, config: RunnableConfig | None = None) -> dict:
    from ai.workflows.unknown_workflow import run_unknown_workflow
    return make_json_safe(await _run_workflow_with_trace(workflow_name="unknown_workflow", func=lambda *, state, config=None: run_unknown_workflow(state=state), state=state, config=config))


async def return_response_node(state: dict) -> dict:
    workflow_response = normalize_workflow_response(state.get("workflowResponse") or state)
    return make_json_safe({
        **state,
        "workflow": {**(state.get("workflow") or {}), "currentPhase": "Return Response"},
        "workflowResponse": workflow_response,
    })


async def _route_to_workflow(state: dict) -> str:
    return (state.get("workflow") or {}).get("activeWorkflow", "unknown_workflow")


def create_banking_graph():
    graph = StateGraph(BankingState)
    graph.add_node("user_request", user_request_node)
    graph.add_node("find_intent", find_intent_node)
    graph.add_node("workflow_router", workflow_router_node)
    graph.add_node("transfer_workflow", run_transfer_workflow_node)
    graph.add_node("transactions_workflow", run_transactions_workflow_node)
    graph.add_node("balance_workflow", run_balance_workflow_node)
    graph.add_node("support_workflow", run_support_workflow_node)
    graph.add_node("personal_details_workflow", run_personal_details_workflow_node)
    graph.add_node("unknown_workflow", run_unknown_workflow_node)
    graph.add_node("return_response", return_response_node)

    graph.add_edge(START, "user_request")
    graph.add_edge("user_request", "find_intent")
    graph.add_edge("find_intent", "workflow_router")
    graph.add_conditional_edges("workflow_router", _route_to_workflow, {
        "transfer_workflow": "transfer_workflow",
        "transactions_workflow": "transactions_workflow",
        "balance_workflow": "balance_workflow",
        "support_workflow": "support_workflow",
        "personal_details_workflow": "personal_details_workflow",
        "unknown_workflow": "unknown_workflow",
    })
    graph.add_edge("transfer_workflow", "return_response")
    graph.add_edge("transactions_workflow", "return_response")
    graph.add_edge("balance_workflow", "return_response")
    graph.add_edge("support_workflow", "return_response")
    graph.add_edge("personal_details_workflow", "return_response")
    graph.add_edge("unknown_workflow", "return_response")
    graph.add_edge("return_response", END)

    return graph.compile(checkpointer=MemorySaver())


banking_graph = create_banking_graph()


async def run_banking_graph(
    *,
    user_input: str,
    user_id: str,
    user_email: str = None,
    history: list = None,
    transfer_payload: dict = None,
    create_chat_completion=None,
    services: dict = None,
    abort_signal=None,
    thread_id: str = None,
) -> dict:
    from langgraph.types import Command

    graph_start = time.perf_counter()
    request_id = get_request_id()
    graph_span = start_span(
        name="run_banking_graph",
        input={"userInput": text_preview(user_input), "history_count": len(history or [])},
        metadata={"thread_id": thread_id or user_id},
    )
    config = {
        "configurable": {
            "thread_id": thread_id or user_id,
            "createChatCompletion": create_chat_completion,
            "services": services,
            "abortSignal": abort_signal,
        }
    }

    # If the graph is paused at an interrupt (active transfer waiting for user),
    # resume it with the new user input instead of starting fresh.
    current = await banking_graph.aget_state(config)
    is_resuming = bool(
        current
        and current.values
        and (current.next or _extract_interrupt_value(state_snapshot=current))
    )

    if is_resuming:
        final_state = await banking_graph.ainvoke(
            Command(resume=make_json_safe({"userInput": user_input, "transferPayload": transfer_payload})),
            config=config,
        )
    else:
        user_language = detect_language(user_input)
        initial_state = create_initial_banking_state(
            user_input=user_input,
            history=history or [],
            user_id=user_id,
            user_email=user_email,
            user_language=user_language,
            transfer_payload=transfer_payload,
        )
        final_state = await banking_graph.ainvoke(make_json_safe(initial_state), config=config)

    # Check if the graph paused at a new interrupt (transfer is still in progress)
    updated = await banking_graph.aget_state(config)
    interrupt_value = _extract_interrupt_value(final_state=final_state, state_snapshot=updated)
    if interrupt_value:
        reply_payload = create_reply_payload(
            history=(final_state or {}).get("history") or history or [],
            user_text=user_input,
            reply=interrupt_value.get("message", ""),
            transfer_state=_transfer_state_for_interrupt(interrupt_value),
            action=_to_client_action(interrupt_value.get("action")),
        )
        graph_ms = (time.perf_counter() - graph_start) * 1000
        trace_fields = get_trace_fields()
        record_event(
            name="response_created",
            metadata={
                "selectedDomain": trace_fields.get("selected_domain"),
                "selectedIntent": trace_fields.get("selected_intent"),
                "selectedWorkflow": trace_fields.get("selected_workflow"),
                "success": True,
                "interrupted": True,
                "actionType": _action_type(reply_payload.get("action")),
                "duration_ms": graph_ms,
            },
        )
        graph_span.end(
            output={
                "duration_ms": graph_ms,
                "interrupted": True,
                "reply": text_preview(reply_payload.get("reply", "")),
                "nextTransferState": reply_payload.get("nextTransferState"),
                "action": reply_payload.get("action"),
            },
            metadata={"duration_ms": graph_ms, "interrupted": True},
        )
        trace_log(f"run_banking_graph requestId={request_id} total_ms={graph_ms:.1f}")
        return reply_payload

    workflow_response = normalize_workflow_response((final_state or {}).get("workflowResponse") or final_state)

    next_transfer_state = (
        workflow_response.get("nextConversationState")
        or ((final_state or {}).get("transfer") or {}).get("nextTransferState")
    )

    reply_payload = create_reply_payload(
        history=(final_state or {}).get("history") or [],
        user_text=(final_state or {}).get("userInput", ""),
        reply=workflow_response.get("message", ""),
        transfer_state=next_transfer_state,
        action=_to_client_action(workflow_response.get("action")),
    )
    graph_ms = (time.perf_counter() - graph_start) * 1000
    trace_fields = get_trace_fields()
    record_event(
        name="response_created",
        metadata={
            "selectedDomain": trace_fields.get("selected_domain"),
            "selectedIntent": trace_fields.get("selected_intent"),
            "selectedWorkflow": trace_fields.get("selected_workflow"),
            "success": True,
            "actionType": _action_type(reply_payload.get("action")),
            "duration_ms": graph_ms,
        },
    )
    graph_span.end(
        output={
            "duration_ms": graph_ms,
            "reply": text_preview(reply_payload.get("reply", "")),
            "nextTransferState": reply_payload.get("nextTransferState"),
            "action": reply_payload.get("action"),
        },
        metadata={"duration_ms": graph_ms},
    )
    trace_log(f"run_banking_graph requestId={request_id} total_ms={graph_ms:.1f}")
    return reply_payload
