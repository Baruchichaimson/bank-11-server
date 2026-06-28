"""
Banking LangGraph — Python port of bankingGraph.js.
Uses langgraph StateGraph with BankingState TypedDict.
"""

from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver
import inspect
import json
from pathlib import Path
import time
from ai.graph.banking_state import BankingState, create_initial_banking_state
from ai.graph.workflow_router import route_workflow
from ai.intents.detect_intent import detect_intent
from ai.contracts.assistant_response_contract import normalize_workflow_response
from ai.contracts.risk_analysis_contract import normalize_risk_analysis
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


def _is_transfer_workflow(state: dict) -> bool:
    return (state.get("workflow") or {}).get("activeWorkflow") == "transfer_workflow"


def _safe_float(value):
    if value is None or value == "":
        return None
    try:
        number = float(value)
        return number if number == number else None
    except (TypeError, ValueError):
        return None


async def _maybe_await(value):
    if inspect.isawaitable(value):
        return await value
    return value


def _risk_transfer_payload(state: dict) -> dict:
    transfer = state.get("transfer") or {}
    intent = state.get("intent") or {}
    intent_payload = intent.get("transferPayload") or {}
    session = state.get("session") or {}
    return {
        "userId": state.get("userId") or session.get("userId"),
        "userEmail": session.get("userEmail"),
        "senderEmail": session.get("userEmail"),
        "receiverEmail": transfer.get("receiverEmail") or intent_payload.get("receiverEmail"),
        "amount": _safe_float(
            transfer.get("amount")
            if transfer.get("amount") is not None
            else intent_payload.get("amount")
        ),
        "senderBalance": _safe_float(
            transfer.get("senderBalance")
            or transfer.get("balance")
            or intent_payload.get("senderBalance")
        ),
    }


def _history_summary(history: list) -> dict:
    items = history or []
    preview = []
    for item in items[-3:]:
        if not isinstance(item, dict):
            continue
        preview.append({
            "role": item.get("role"),
            "content": text_preview(item.get("content", ""), max_chars=80),
        })
    return {"count": len(items), "recentPreview": preview}


async def _enrich_risk_payload_from_services(payload: dict, services: dict | None) -> dict:
    services = services or {}
    profile_service = services.get("profileService")
    account_service = services.get("accountService")
    user_id = payload.get("userId")
    enriched = dict(payload)

    sender_user = None
    if profile_service and user_id and not enriched.get("senderEmail"):
        getter = getattr(profile_service, "getUserById", None)
        if getter:
            try:
                sender_user = await _maybe_await(getter(user_id))
                enriched["senderEmail"] = str((sender_user or {}).get("email") or "").lower() or None
            except Exception:
                sender_user = None

    if account_service and user_id and enriched.get("senderBalance") is None:
        getter = getattr(account_service, "get_account_by_user_id", None)
        if getter:
            try:
                account = await _maybe_await(getter(str((sender_user or {}).get("_id") or user_id)))
                enriched["senderBalance"] = _safe_float((account or {}).get("balance"))
            except Exception:
                pass

    return enriched


def _not_evaluated_deterministic_risk(reason: str, payload: dict) -> dict:
    return {
        "status": "not_evaluated",
        "level": None,
        "score": None,
        "requiresReview": False,
        "reasons": [reason],
        "checks": {
            "hasSenderEmail": bool(payload.get("senderEmail")),
            "hasReceiverEmail": bool(payload.get("receiverEmail")),
            "hasAmount": payload.get("amount") is not None,
            "hasSenderBalance": payload.get("senderBalance") is not None,
        },
    }


def _risk_payload_complete(payload: dict) -> bool:
    return bool(
        payload.get("senderEmail")
        and payload.get("receiverEmail")
        and payload.get("amount") is not None
        and payload.get("senderBalance") is not None
    )


def _read_risk_analysis_prompt() -> str:
    path = Path(__file__).resolve().parents[2] / "prompts" / "risk_analysis.md"
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return (
            "You are a bank transfer risk analysis model. Return JSON only with "
            '{"level":"LOW|MEDIUM|HIGH","reason":"..."}'
        )


def _extract_llm_content(response) -> str:
    try:
        return response.choices[0].message.content
    except Exception:
        pass
    if isinstance(response, dict):
        choices = response.get("choices") or []
        if choices:
            message = (choices[0] or {}).get("message") or {}
            return message.get("content") or ""
    return ""


async def deterministic_risk_node(state: dict, config: RunnableConfig | None = None) -> dict:
    if not _is_transfer_workflow(state):
        return state

    services = _get_services(config) or {}
    payload = await _enrich_risk_payload_from_services(_risk_transfer_payload(state), services)
    span = start_span(
        name="deterministic_risk_node",
        input={
            "hasSenderEmail": bool(payload.get("senderEmail")),
            "hasReceiverEmail": bool(payload.get("receiverEmail")),
            "hasAmount": payload.get("amount") is not None,
            "hasSenderBalance": payload.get("senderBalance") is not None,
        },
        metadata={"workflow_name": "transfer_workflow"},
    )

    if not _risk_payload_complete(payload):
        result = _not_evaluated_deterministic_risk("Transfer details incomplete; deterministic risk not evaluated.", payload)
    else:
        try:
            risk_service = services.get("riskService")
            if not risk_service:
                from ai.services.risk_service import create_risk_service
                risk_service = create_risk_service()
            evaluator = getattr(risk_service, "evaluateRisk", None) or getattr(risk_service, "evaluate_risk", None)
            result = evaluator({
                "senderEmail": str(payload.get("senderEmail") or "").lower(),
                "receiverEmail": str(payload.get("receiverEmail") or "").lower(),
                "amount": payload.get("amount"),
                "senderBalance": payload.get("senderBalance"),
            }) if evaluator else _not_evaluated_deterministic_risk("Risk service unavailable.", payload)
        except Exception as err:
            result = {
                **_not_evaluated_deterministic_risk("Deterministic risk evaluation failed.", payload),
                "error": str(err),
            }

    summary = {
        "level": result.get("level"),
        "score": result.get("score"),
        "requiresReview": result.get("requiresReview"),
        "reasonCount": len(result.get("reasons") or []),
    }
    span.end(output=summary, metadata=summary)
    record_event(name="deterministic_risk_evaluated", metadata=summary)

    return make_json_safe({
        **state,
        "deterministicRisk": result,
        "audit": {
            **(state.get("audit") or {}),
            "aiDecisions": [*((state.get("audit") or {}).get("aiDecisions") or []), {"node": "deterministic_risk_node", **summary}],
        },
    })


async def risk_analysis_node(state: dict, config: RunnableConfig | None = None) -> dict:
    if not _is_transfer_workflow(state):
        return state

    configurable = (config or {}).get("configurable") or {}
    create_chat_completion = configurable.get("createChatCompletion")
    payload = await _enrich_risk_payload_from_services(_risk_transfer_payload(state), configurable.get("services"))
    llm_payload = {
        "operation": "risk_analysis",
        "userId": payload.get("userId"),
        "userEmail": payload.get("userEmail"),
        "senderEmail": payload.get("senderEmail"),
        "receiverEmail": payload.get("receiverEmail"),
        "amount": payload.get("amount"),
        "senderBalance": payload.get("senderBalance"),
        "historySummary": _history_summary(state.get("history") or []),
        "deterministicRisk": state.get("deterministicRisk"),
    }
    span = start_span(
        name="risk_analysis_node",
        input={
            "operation": "risk_analysis",
            "hasAmount": payload.get("amount") is not None,
            "hasReceiverEmail": bool(payload.get("receiverEmail")),
            "hasDeterministicRisk": bool(state.get("deterministicRisk")),
        },
        metadata={"operation": "risk_analysis"},
    )

    parsed = {}
    if create_chat_completion and _risk_payload_complete(payload):
        try:
            response = await create_chat_completion({
                "temperature": 0,
                "response_format": {"type": "json_object"},
                "operation": "risk_analysis",
                "messages": [
                    {"role": "system", "content": _read_risk_analysis_prompt()},
                    {"role": "user", "content": json.dumps(make_json_safe(llm_payload), ensure_ascii=False)},
                ],
            })
            content = _extract_llm_content(response)
            parsed = json.loads(str(content or "").strip())
            if not isinstance(parsed, dict):
                parsed = {}
            if getattr(response, "model", None) and not parsed.get("model"):
                parsed["model"] = getattr(response, "model")
            if getattr(response, "provider", None) and not parsed.get("provider"):
                parsed["provider"] = getattr(response, "provider")
        except Exception as err:
            parsed = {"reason": f"Risk analysis LLM output unavailable or invalid: {err}"}
    elif not _risk_payload_complete(payload):
        parsed = {"reason": "Transfer details incomplete; risk analysis unavailable."}
    else:
        parsed = {"reason": "Risk analysis LLM unavailable."}

    normalized = normalize_risk_analysis(parsed)
    summary = {
        "operation": "risk_analysis",
        "provider": normalized.get("provider"),
        "model": normalized.get("model"),
        "level": normalized.get("level"),
        "reasonPreview": text_preview(normalized.get("reason", ""), max_chars=120),
    }
    span.end(output=summary, metadata=summary)
    record_event(name="risk_analysis_completed", metadata=summary)

    return make_json_safe({
        **state,
        "riskAnalysis": normalized,
        "audit": {
            **(state.get("audit") or {}),
            "aiDecisions": [*((state.get("audit") or {}).get("aiDecisions") or []), {"node": "risk_analysis_node", **summary}],
        },
    })


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
    graph.add_node("deterministic_risk_node", deterministic_risk_node)
    graph.add_node("risk_analysis_node", risk_analysis_node)
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
        "transfer_workflow": "deterministic_risk_node",
        "transactions_workflow": "transactions_workflow",
        "balance_workflow": "balance_workflow",
        "support_workflow": "support_workflow",
        "personal_details_workflow": "personal_details_workflow",
        "unknown_workflow": "unknown_workflow",
    })
    graph.add_edge("deterministic_risk_node", "risk_analysis_node")
    graph.add_edge("risk_analysis_node", "transfer_workflow")
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
