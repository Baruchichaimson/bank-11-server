"""
Banking LangGraph — Python port of bankingGraph.js.
Uses langgraph StateGraph with BankingState TypedDict.
"""

from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
from ai.graph.banking_state import BankingState, create_initial_banking_state
from ai.graph.workflow_router import route_workflow
from ai.intents.detect_intent import detect_intent
from ai.contracts.assistant_response_contract import normalize_workflow_response
from ai.assistant.shared import detect_language, create_reply_payload
from config.settings import BANKING_GRAPH_DEBUG


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
    return {"type": action["type"]}


async def user_request_node(state: dict) -> dict:
    return {
        **state,
        "workflow": {**(state.get("workflow") or {}), "currentPhase": "User Request"},
        "audit": {
            **(state.get("audit") or {}),
            "transitions": [*((state.get("audit") or {}).get("transitions") or []), "User Request"],
        },
    }


async def find_intent_node(state: dict, config: RunnableConfig | None = None) -> dict:
    configurable = (config or {}).get("configurable") or {}

    detection = await detect_intent(
        user_input=state.get("userInput", ""),
        history=state.get("history") or [],
        create_chat_completion=configurable.get("createChatCompletion"),
        abort_signal=configurable.get("abortSignal"),
    )
    detection["detectedIntent"] = detection["intent"]
    _debug("BANKING GRAPH DETECTED INTENT", detection.get("intent"), detection.get("source"))

    return {
        **state,
        "intent": detection,
        "audit": {
            **(state.get("audit") or {}),
            "transitions": [*((state.get("audit") or {}).get("transitions") or []), f"Intent: {detection['intent']}"],
        },
    }


async def workflow_router_node(state: dict) -> dict:
    intent = state.get("intent") or {}
    workflow = route_workflow(
        intent=intent.get("intent") or intent.get("detectedIntent") or "unknown",
        domain=intent.get("domain"),
    )
    _debug("BANKING GRAPH SELECTED WORKFLOW", workflow)
    return {
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
    }


def _get_services(config):
    return (config or {}).get("configurable", {}).get("services")


async def run_transfer_workflow_node(state: dict, config: RunnableConfig | None = None) -> dict:
    from ai.workflows.transfer.transfer_state_machine import run_transfer_node
    return await run_transfer_node(state=state, config=config)


async def run_transactions_workflow_node(state: dict, config: RunnableConfig | None = None) -> dict:
    from ai.workflows.transactions_workflow import run_transactions_workflow
    return await run_transactions_workflow(state=state, services=_get_services(config))


async def run_balance_workflow_node(state: dict, config: RunnableConfig | None = None) -> dict:
    from ai.workflows.balance_workflow import run_balance_workflow
    return await run_balance_workflow(state=state, services=_get_services(config))


async def run_support_workflow_node(state: dict, config: RunnableConfig | None = None) -> dict:
    from ai.workflows.support_workflow import run_support_workflow
    return await run_support_workflow(state=state, services=_get_services(config))


async def run_personal_details_workflow_node(state: dict, config: RunnableConfig | None = None) -> dict:
    from ai.workflows.personal_details_workflow import run_personal_details_workflow
    return await run_personal_details_workflow(state=state, services=_get_services(config))


async def run_unknown_workflow_node(state: dict, config: RunnableConfig | None = None) -> dict:
    from ai.workflows.unknown_workflow import run_unknown_workflow
    return await run_unknown_workflow(state=state)


async def return_response_node(state: dict) -> dict:
    workflow_response = normalize_workflow_response(state.get("workflowResponse") or state)
    return {
        **state,
        "workflow": {**(state.get("workflow") or {}), "currentPhase": "Return Response"},
        "workflowResponse": workflow_response,
    }


def _route_to_workflow(state: dict) -> str:
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
    is_resuming = bool(current and current.values and current.next)

    if is_resuming:
        final_state = await banking_graph.ainvoke(
            Command(resume={"userInput": user_input, "transferPayload": transfer_payload}),
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
        final_state = await banking_graph.ainvoke(initial_state, config=config)

    # Check if the graph paused at a new interrupt (transfer is still in progress)
    updated = await banking_graph.aget_state(config)
    if updated and updated.next:
        interrupt_value = {}
        for task in (updated.tasks or []):
            for intr in (task.interrupts or []):
                interrupt_value = intr.value or {}
                break
        return create_reply_payload(
            history=(final_state or {}).get("history") or history or [],
            user_text=user_input,
            reply=interrupt_value.get("message", ""),
            transfer_state={"phase": "form_open"},  # signals active transfer to client
            action=_to_client_action(interrupt_value.get("action")),
        )

    workflow_response = normalize_workflow_response((final_state or {}).get("workflowResponse") or final_state)

    next_transfer_state = (
        workflow_response.get("nextConversationState")
        or ((final_state or {}).get("transfer") or {}).get("nextTransferState")
    )

    return create_reply_payload(
        history=(final_state or {}).get("history") or [],
        user_text=(final_state or {}).get("userInput", ""),
        reply=workflow_response.get("message", ""),
        transfer_state=next_transfer_state,
        action=_to_client_action(workflow_response.get("action")),
    )
