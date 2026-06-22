"""
Transfer state machine — LangGraph subgraph.
Implements the same phases: idle, form_open, await_confirmation.
"""

import re
import time
from langchain_core.runnables import RunnableConfig
from langgraph.graph import StateGraph, START, END
from typing_extensions import TypedDict
from typing import Any, Optional
from ai.contracts.assistant_response_contract import create_executed_workflow_response, create_workflow_response
from observability.langfuse_tracing import get_request_id, record_event, start_span, start_tool, trace_log

TRANSFER_PHASE_IDLE = "idle"
TRANSFER_PHASE_FORM_OPEN = "form_open"
TRANSFER_PHASE_AWAIT_CONFIRMATION = "await_confirmation"

EXTRA_CONFIRMATION_THRESHOLD = 1000

RISK_RULES_AND_LIMITS = {
    "extraConfirmationThreshold": EXTRA_CONFIRMATION_THRESHOLD,
    "maxSingleTransferAmount": 20000,
    "lowRemainingBalanceThreshold": 250,
    "velocityWindowMinutes": 60,
    "velocityModerateCount": 3,
    "velocityHighCount": 5,
}

RESET_TRANSFER_FLOW = {
    "phase": TRANSFER_PHASE_IDLE,
    "receiverEmail": "",
    "amount": None,
    "description": "",
    "riskConfirmationAsked": False,
    "flowLanguage": "",
}

EMAIL_PATTERN = re.compile(r"^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$", re.IGNORECASE)


class TransferState(TypedDict, total=False):
    userInput: str
    userLanguage: str
    flowLanguage: str
    userId: str
    phase: str
    receiverEmail: str
    amount: Optional[float]
    description: str
    riskConfirmationAsked: bool
    lastValidationError: Any
    semanticIntent: str
    transferPayload: Any
    correction: Any
    transferIntent: bool
    handled: bool
    shouldRunTransfer: bool
    transferExecuted: bool
    reply: str
    action: Any
    errorMessage: Optional[str]
    senderUser: Any
    receiverUser: Any
    senderAccount: Any
    receiverAccount: Any
    riskRulesAndLimits: Any
    riskAssessment: Any
    transactionResult: Any
    suggestions: Any


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_payload_email(value) -> str:
    if not isinstance(value, str):
        return ""
    email = value.strip().lower()
    return email if EMAIL_PATTERN.match(email) else ""


def _normalize_payload_amount(value):
    if value is None or value == "" or value is False:
        return None
    try:
        amount = float(str(value).replace(",", "."))
        return amount if amount > 0 else None
    except (ValueError, TypeError):
        return None


def _normalize_payload_description(value) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def normalize_transfer_payload(payload: dict) -> dict:
    payload = payload or {}
    confirmation = payload.get("confirmation")
    confirmation = confirmation if confirmation in ("yes", "no") else None
    return {
        "receiverEmail": _normalize_payload_email(payload.get("receiverEmail")),
        "amount": _normalize_payload_amount(payload.get("amount")),
        "description": _normalize_payload_description(payload.get("description")),
        "confirmation": confirmation,
        "skipDescription": bool(payload.get("skipDescription")),
        "startNewTransfer": bool(payload.get("startNewTransfer")),
    }


def has_meaningful_transfer_payload(payload: dict) -> bool:
    payload = payload or {}
    return bool(
        payload.get("receiverEmail")
        or payload.get("amount")
        or payload.get("description")
        or payload.get("confirmation")
        or payload.get("skipDescription")
        or payload.get("startNewTransfer")
    )


async def _extract_transfer_details_with_llm(*, user_input: str, phase: str, create_chat_completion, abort_signal=None) -> dict:
    if not create_chat_completion:
        return _empty_transfer_payload()
    try:
        import json
        response = await create_chat_completion({
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": "\n".join([
                    "You extract fields for an already-active money transfer workflow.",
                    "Do not classify user intent, route workflows, or answer the user.",
                    f"Current transfer phase: {phase}.",
                    "Return only strict JSON with this shape:",
                    '{"receiverEmail":null,"amount":null,"description":null,"confirmation":null,"skipDescription":false,"startNewTransfer":false}',
                    "Extract only values explicitly present in the current message.",
                    'confirmation must be "yes", "no", or null.'
                ])},
                {"role": "user", "content": str(user_input or "").strip()},
            ],
        })
        content = response.choices[0].message.content if response else ""
        parsed = json.loads(str(content or "").strip())
        inner = parsed.get("transferPayload") or parsed or {}
        return normalize_transfer_payload(inner)
    except Exception:
        return _empty_transfer_payload()


def _empty_transfer_payload() -> dict:
    return {
        "receiverEmail": "",
        "amount": None,
        "description": "",
        "confirmation": None,
        "skipDescription": False,
        "startNewTransfer": False,
    }


async def get_semantic_transfer_payload(*, state: dict, create_chat_completion=None, abort_signal=None) -> dict:
    payload = state.get("transferPayload") or {}
    correction = state.get("correction") or {}
    merged = dict(payload)

    if correction.get("field") == "recipient" and merged.get("receiverEmail") is None:
        merged["receiverEmail"] = correction.get("value")
    if correction.get("field") == "amount" and merged.get("amount") is None:
        merged["amount"] = correction.get("value")
    if correction.get("field") == "note" and merged.get("description") is None:
        merged["description"] = correction.get("value")

    normalized = normalize_transfer_payload(merged)
    phase = state.get("phase") or TRANSFER_PHASE_IDLE

    if phase == TRANSFER_PHASE_IDLE:
        return normalized

    if has_meaningful_transfer_payload(normalized):
        return normalized

    llm_extracted = await _extract_transfer_details_with_llm(
        user_input=state.get("userInput", ""),
        phase=phase,
        create_chat_completion=create_chat_completion,
        abort_signal=abort_signal,
    )

    return {
        "receiverEmail": normalized.get("receiverEmail") or llm_extracted.get("receiverEmail") or "",
        "amount": normalized.get("amount") if normalized.get("amount") is not None else llm_extracted.get("amount"),
        "description": normalized.get("description") or llm_extracted.get("description") or "",
        "confirmation": normalized.get("confirmation") or llm_extracted.get("confirmation"),
        "skipDescription": bool(normalized.get("skipDescription") or llm_extracted.get("skipDescription")),
        "startNewTransfer": bool(normalized.get("startNewTransfer") or llm_extracted.get("startNewTransfer")),
    }


# ---------------------------------------------------------------------------
# Response builders
# ---------------------------------------------------------------------------

def format_ils(value) -> str:
    return f"{float(value or 0):.2f}"


def build_transfer_form_error_action(field: str, message: str, language: str) -> dict:
    return {"type": "transfer_form_error", "field": field, "message": message, "language": language}


def build_open_transfer_form_action(language: str) -> dict:
    return {"type": "open_money_transfer_inline", "language": language}


def build_high_amount_confirm_action(language: str, amount) -> dict:
    msg = (
        f"הסכום הוא {format_ils(amount)} ILS (מעל {EXTRA_CONFIRMATION_THRESHOLD}). האם לבצע את ההעברה?"
        if language == "he"
        else f"The amount is {format_ils(amount)} ILS (above {EXTRA_CONFIRMATION_THRESHOLD}). Do you want to proceed?"
    )
    return {"type": "transfer_high_amount_confirm", "language": language, "amount": float(amount or 0), "message": msg}


def build_reset_transfer_form_action(language: str) -> dict:
    return {"type": "reset_transfer_form", "language": language}


def build_low_balance_suggestion(language: str, balance: float) -> str | None:
    if balance > 300:
        return None
    return (
        f"היתרה שלך לאחר ההעברה נמוכה ({balance} ILS). רוצה שאציג לך הלוואה?"
        if language == "he"
        else f"Your post-transfer balance is low ({balance} ILS). Do you want me to suggest a loan?"
    )


def build_transfer_success_reply(*, language: str, amount, receiver_email: str, balance, suggestions: list) -> str:
    valid_suggestions = [s for s in (suggestions or []) if s]

    if language == "he":
        lines = [
            "ההעברה הושלמה בהצלחה", "",
            "תוצאת ההעברה", "--------------------",
            "סטטוס: הצליח",
            f"סכום: {format_ils(amount)} ILS",
            f"נמען: {receiver_email or '-'}",
            f"יתרה חדשה: {format_ils(balance)} ILS",
            "",
            "AI Suggestions:",
            *(valid_suggestions if valid_suggestions else ["אין כרגע הצעות נוספות."]),
            "",
            "Safety Tips:",
            "ודא שכתובת האימייל של המקבל נכונה לפני העברה נוספת.",
        ]
    else:
        lines = [
            "Transfer completed successfully", "",
            "Transaction Result:", "--------------------",
            "Status: Success",
            f"Amount: {format_ils(amount)} ILS",
            f"Recipient: {receiver_email or '-'}",
            f"Balance after transfer: {format_ils(balance)} ILS",
            "",
            "AI Suggestions:",
            *(valid_suggestions if valid_suggestions else ["No additional suggestions right now."]),
            "",
            "Safety Tips:",
            "Verify the recipient email before making another transfer.",
        ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Interrupt-driven node  (Phase B — replaces the subgraph above)
# ---------------------------------------------------------------------------

async def run_transfer_node(state: dict, config: RunnableConfig | None = None) -> dict:
    """
    Single-node transfer workflow using LangGraph interrupt() for multi-turn collection.
    The graph pauses at each interrupt() and resumes when the user sends the next message.
    All phase bookkeeping is handled by the checkpointer — no manual nextTransferState needed.
    """
    from langgraph.types import interrupt
    from ai.contracts.assistant_response_contract import create_workflow_response, create_executed_workflow_response

    configurable = (config or {}).get("configurable") or {}
    services = configurable.get("services")
    create_chat_completion = configurable.get("createChatCompletion")
    workflow_start = time.perf_counter()
    workflow_span = start_span(name="transfer_workflow", metadata={"workflow_name": "transfer_workflow"})

    session = state.get("session") or {}
    user_language = session.get("userLanguage", "en")
    user_id = str(session.get("userId") or "")
    intent = state.get("intent") or {}
    transfer = state.get("transfer") or {}

    receiver_email = transfer.get("receiverEmail") or ""
    amount = transfer.get("amount")
    description = transfer.get("description") or ""
    flow_language = transfer.get("flowLanguage") or user_language

    # ── Inline helpers ─────────────────────────────────────────────────────

    def _missing_fields():
        return [
            field for field, is_missing in (
                ("receiverEmail", not receiver_email),
                ("amount", amount is None),
            )
            if is_missing
        ]

    def _action_type(action):
        return action.get("type") if isinstance(action, dict) else action

    def _finish(result_state: dict, **summary):
        ms = (time.perf_counter() - workflow_start) * 1000
        workflow_response = result_state.get("workflowResponse") or {}
        action = workflow_response.get("action")
        execution = workflow_response.get("execution") or {}
        output = {
            "workflow_name": "transfer_workflow",
            "phase": (result_state.get("transfer") or {}).get("phase") or transfer.get("phase"),
            "missing_fields": _missing_fields(),
            "action_type": _action_type(action),
            "operation": execution.get("operation"),
            "duration_ms": ms,
            **summary,
        }
        workflow_span.end(output=output, metadata=output)
        trace_log(f"workflow requestId={get_request_id()} name=transfer_workflow ms={ms:.1f}")
        return result_state

    def _cancel():
        msg = "ביטלתי את תהליך ההעברה." if flow_language == "he" else "I canceled the transfer flow."
        return _finish({
            **state,
            "workflowResponse": create_workflow_response(
                message=msg,
                action=build_reset_transfer_form_action(flow_language),
                next_conversation_state=None,
                execution={"executed": False, "operation": "transfer_money", "result": None},
            ),
            "transfer": {**(state.get("transfer") or {}), **RESET_TRANSFER_FLOW},
        }, result_status="cancelled")

    def _error(msg):
        record_event(
            name="error_occurred",
            metadata={
                "selectedWorkflow": "transfer_workflow",
                "success": False,
            },
        )
        return _finish({
            **state,
            "workflowResponse": create_workflow_response(
                message=msg, action=None, next_conversation_state=None,
                execution={"executed": False, "operation": "transfer_money", "result": None},
            ),
            "transfer": {**(state.get("transfer") or {}), **RESET_TRANSFER_FLOW},
        }, result_status="error")

    def _form_error(field, msg):
        record_event(
            name="validation_failed",
            metadata={
                "selectedWorkflow": "transfer_workflow",
                "missingFields": [field],
                "reason": field,
                "success": False,
            },
        )
        safe_email = "" if field == "receiverEmail" else receiver_email
        safe_amount = None if field == "amount" else amount
        return _finish({
            **state,
            "workflowResponse": create_workflow_response(
                message="",
                action=build_transfer_form_error_action(field, msg, flow_language),
                next_conversation_state={
                    "phase": TRANSFER_PHASE_FORM_OPEN,
                    "receiverEmail": safe_email,
                    "amount": safe_amount,
                    "description": description,
                    "flowLanguage": flow_language,
                },
                execution={"executed": False, "operation": "transfer_money", "result": None},
            ),
            "transfer": {
                **(state.get("transfer") or {}),
                "phase": TRANSFER_PHASE_FORM_OPEN,
                "receiverEmail": safe_email,
                "amount": safe_amount,
                "nextTransferState": {"phase": TRANSFER_PHASE_FORM_OPEN, "flowLanguage": flow_language},
            },
        }, result_status="form_error", error_field=field)

    async def _parse(user_input, payload, phase):
        return await get_semantic_transfer_payload(
            state={
                "userInput": user_input,
                "userLanguage": user_language,
                "flowLanguage": flow_language,
                "phase": phase,
                "transferPayload": payload or {},
                "correction": None,
            },
            create_chat_completion=create_chat_completion,
        )

    # ── 1. Parse initial message ───────────────────────────────────────────

    initial_phase = TRANSFER_PHASE_FORM_OPEN if (receiver_email or amount is not None) else TRANSFER_PHASE_IDLE
    semantic = await _parse(
        user_input=state.get("userInput", ""),
        payload=intent.get("transferPayload") or {},
        phase=initial_phase,
    )

    if semantic.get("confirmation") == "no":
        return _cancel()

    if semantic.get("startNewTransfer"):
        receiver_email, amount, description = "", None, ""
        flow_language = user_language
        semantic = {}
    else:
        if semantic.get("receiverEmail"):
            receiver_email = semantic["receiverEmail"]
        if semantic.get("amount") is not None:
            amount = semantic["amount"]
        if semantic.get("description"):
            description = semantic["description"]

    # ── 2. Collect missing details (interrupt until we have email + amount) ─

    while not (receiver_email and amount is not None):
        missing_fields = _missing_fields()
        record_event(
            name="missing_required_fields",
            metadata={
                "selectedWorkflow": "transfer_workflow",
                "missingFields": missing_fields,
            },
        )
        tool_start = time.perf_counter()
        action = build_open_transfer_form_action(flow_language)
        tool = start_tool(
            name="open_money_transfer_inline",
            input={"missingFields": missing_fields},
            metadata={"toolName": "open_money_transfer_inline", "missingFields": missing_fields},
        )
        tool_summary = {
            "toolName": "open_money_transfer_inline",
            "success": True,
            "actionType": "open_money_transfer_inline",
            "missingFields": missing_fields,
            "duration_ms": (time.perf_counter() - tool_start) * 1000,
        }
        tool.end(output=tool_summary, metadata=tool_summary)
        resume = interrupt({
            "type": "open_transfer_form",
            "message": (
                "פתחתי עבורך טופס העברה. מלא פרטים ולחץ שלח."
                if flow_language == "he"
                else "I opened a transfer form in the chat. Fill in the details and submit."
            ),
            "action": action,
        })

        new_payload = resume.get("transferPayload") or {}
        new_sem = await _parse(
            user_input=resume.get("userInput", ""),
            payload=new_payload,
            phase=TRANSFER_PHASE_FORM_OPEN,
        )

        if new_sem.get("confirmation") == "no" or new_payload.get("confirmation") == "no":
            return _cancel()

        if new_sem.get("receiverEmail"):
            receiver_email = new_sem["receiverEmail"]
        if new_sem.get("amount") is not None:
            amount = new_sem["amount"]
        if new_sem.get("description"):
            description = new_sem["description"]

    # ── 3. Validate users and accounts ────────────────────────────────────

    profile_service = (services or {}).get("profileService")
    account_service = (services or {}).get("accountService")

    try:
        sender_user = profile_service.getUserById(user_id) if profile_service else None
        if not sender_user:
            return _error(
                "לא הצלחתי לזהות את המשתמש המחובר." if flow_language == "he"
                else "I could not identify the authenticated user."
            )

        receiver_user = profile_service.getUserByEmail(str(receiver_email).lower()) if profile_service else None
        if not receiver_user:
            return _form_error(
                "receiverEmail",
                "המשתמש לא קיים במערכת. בדוק את כתובת האימייל." if flow_language == "he"
                else "Recipient user does not exist. Please check the email.",
            )

        if str(receiver_user["_id"]) == str(sender_user["_id"]):
            return _form_error(
                "receiverEmail",
                "אי אפשר לבצע העברה לעצמך. הזן אימייל של נמען אחר." if flow_language == "he"
                else "You cannot transfer money to yourself.",
            )

        sender_account = await account_service.get_account_by_user_id(str(sender_user["_id"])) if account_service else None
        receiver_account = await account_service.get_account_by_user_id(str(receiver_user["_id"])) if account_service else None

        if not sender_account or not receiver_account:
            return _error(
                "לא נמצא חשבון מקור או יעד." if flow_language == "he"
                else "Source or target account was not found."
            )

        sender_balance = float(sender_account.get("balance") or 0)
        if not (float(amount) > 0 and float(amount) <= sender_balance):
            return _form_error(
                "amount",
                f"אין מספיק יתרה: ביקשת {amount} ILS, יתרה זמינה {sender_balance} ILS."
                if flow_language == "he"
                else f"Insufficient balance: requested {amount} ILS, available {sender_balance} ILS.",
            )

    except Exception as err:
        return _error(
            f"ההעברה נכשלה: {err}" if flow_language == "he" else f"Transfer failed: {err}"
        )

    # ── 4. Risk check ──────────────────────────────────────────────────────

    risk_service = (services or {}).get("riskService")
    risk_assessment = {"requiresReview": False}
    if risk_service:
        try:
            risk_assessment = risk_service.evaluateRisk({
                "senderEmail": str(sender_user.get("email") or "").lower(),
                "receiverEmail": str(receiver_user.get("email") or "").lower(),
                "amount": float(amount),
                "senderBalance": sender_account.get("balance"),
            })
        except Exception:
            pass

    if risk_assessment.get("requiresReview"):
        reasons = ", ".join(risk_assessment.get("reasons") or []) or "Policy checks"
        return _error(
            f"ההעברה סומנה בסיכון גבוה ונשלחה לבדיקה ידנית. סיבה: {reasons}." if flow_language == "he"
            else f"This transfer was flagged as high risk and sent to manual review. Reason: {reasons}."
        )

    # ── 5. High-amount confirmation ────────────────────────────────────────

    if float(amount) > EXTRA_CONFIRMATION_THRESHOLD:
        resume = interrupt({
            "type": "high_amount_confirm",
            "action": build_high_amount_confirm_action(flow_language, amount),
        })
        confirm_sem = await _parse(
            user_input=resume.get("userInput", ""),
            payload={"confirmation": (resume.get("transferPayload") or {}).get("confirmation")},
            phase=TRANSFER_PHASE_AWAIT_CONFIRMATION,
        )
        if confirm_sem.get("confirmation") != "yes":
            return _cancel()

    # ── 6. Execute ─────────────────────────────────────────────────────────

    try:
        transaction_service = (services or {}).get("transactionService")
        if not transaction_service:
            raise ValueError("Transfer service unavailable")

        transaction = await transaction_service.execute_transfer(
            from_account_id=sender_account["_id"],
            to_account_id=receiver_account["_id"],
            amount=float(amount),
            description=description or None,
        )

        updated_sender = (
            await account_service.find_account_by_id(sender_account["_id"])
            if account_service else None
        )
        remaining_balance = float((updated_sender or sender_account).get("balance") or 0)

    except Exception as err:
        return _error(
            f"ההעברה נכשלה: {err}" if flow_language == "he" else f"Transfer failed: {err}"
        )

    # ── 7. Build success response ──────────────────────────────────────────

    suggestions = []
    low_sug = build_low_balance_suggestion(flow_language, remaining_balance)
    if low_sug:
        suggestions.append(low_sug)

    try:
        from datetime import datetime, timezone, timedelta
        one_month_ago = datetime.now(timezone.utc) - timedelta(days=30)
        monthly_count = await transaction_service.count_monthly_outgoing_transfers(
            email=str(sender_user.get("email") or "").lower(),
            since=one_month_ago,
        ) if transaction_service else 0
        if monthly_count >= 10:
            suggestions.append(
                "ראיתי נפח העברות גבוה בחודש האחרון. רוצה שאציג לך תקרת תקציב חודשית?" if flow_language == "he"
                else "You had high transfer activity. Want me to suggest a monthly transfer budget cap?"
            )
    except Exception:
        pass

    reply = build_transfer_success_reply(
        language=flow_language,
        amount=amount,
        receiver_email=receiver_email,
        balance=remaining_balance,
        suggestions=suggestions,
    )

    workflow_response = create_executed_workflow_response(
        message=reply,
        action=None,
        next_conversation_state=None,
        operation="transfer_money",
        result={"transaction": transaction, "suggestions": suggestions},
    )

    return _finish({
        **state,
        "workflowResponse": workflow_response,
        "execution": workflow_response["execution"],
        "transfer": {**(state.get("transfer") or {}), **RESET_TRANSFER_FLOW, "nextTransferState": None},
    }, result_status="executed", suggestions_count=len(suggestions))
