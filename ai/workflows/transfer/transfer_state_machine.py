"""
Transfer state machine — Python port of transferStateMachine.js.
Implements the same phases: idle, form_open, await_confirmation.
"""

import re
from ai.contracts.assistant_response_contract import create_executed_workflow_response, create_workflow_response

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

    merged_result = {
        "receiverEmail": normalized.get("receiverEmail") or llm_extracted.get("receiverEmail") or "",
        "amount": normalized.get("amount") if normalized.get("amount") is not None else llm_extracted.get("amount"),
        "description": normalized.get("description") or llm_extracted.get("description") or "",
        "confirmation": normalized.get("confirmation") or llm_extracted.get("confirmation"),
        "skipDescription": bool(normalized.get("skipDescription") or llm_extracted.get("skipDescription")),
        "startNewTransfer": bool(normalized.get("startNewTransfer") or llm_extracted.get("startNewTransfer")),
    }
    return merged_result


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


def build_transfer_confirmation_summary(*, language: str, amount, receiver_email: str, description: str) -> str:
    desc_part = f"\nDescription: {description}" if description else ""
    if language == "he":
        desc_part = f"\nתיאור: {description}" if description else ""
        return (
            f"לפני ביצוע ההעברה, נא לאשר את הפרטים:\nסכום: {amount} ILS\nנמען: {receiver_email}{desc_part}\n\n"
            "אם הכול נכון כתוב \"כן\". לביטול כתוב \"לא\"."
        )
    return (
        f"Before I execute the transfer, please confirm the details:\nAmount: {amount} ILS\nRecipient: {receiver_email}{desc_part}\n\n"
        "If everything is correct, type \"yes\". To cancel, type \"no\"."
    )


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
# Transfer state machine (sequential, not LangGraph sub-graph)
# ---------------------------------------------------------------------------

async def run_transfer_state_machine(
    *,
    user_input: str,
    user_language: str,
    user_id: str,
    transfer_state: dict,
    semantic_intent: str = "unknown",
    transfer_payload: dict = None,
    correction: dict = None,
    services: dict,
    create_chat_completion=None,
    abort_signal=None,
) -> dict:
    state = {
        "userInput": user_input,
        "userLanguage": user_language,
        "flowLanguage": (transfer_state or {}).get("flowLanguage") or ("he" if user_language == "he" else "en"),
        "userId": user_id,
        "phase": _normalize_transfer_phase((transfer_state or {}).get("phase")),
        "receiverEmail": (transfer_state or {}).get("receiverEmail", ""),
        "amount": (transfer_state or {}).get("amount"),
        "description": (transfer_state or {}).get("description", ""),
        "riskConfirmationAsked": bool((transfer_state or {}).get("riskConfirmationAsked")),
        "lastValidationError": (transfer_state or {}).get("lastValidationError"),
        "handled": False,
        "reply": "",
        "action": None,
        "shouldRunTransfer": False,
        "transferExecuted": False,
        "semanticIntent": semantic_intent,
        "transferPayload": transfer_payload,
        "correction": correction,
    }

    state = await _parse_input_node(state, create_chat_completion=create_chat_completion)
    if not (state.get("handled") and not state.get("shouldRunTransfer")):
        state = await _validate_transfer_node(state, services=services, user_language=user_language)
    if not (state.get("handled") and not state.get("shouldRunTransfer")):
        state = await _risk_check_node(state, services=services)
    if not (state.get("handled") and not state.get("shouldRunTransfer")):
        state = await _execute_transfer_node(state, services=services)
    state = await _build_response_node(state, services=services)

    return state


def _normalize_transfer_phase(phase: str | None) -> str:
    if phase in ("collect_receiver", "collect_amount", "collect_description"):
        return TRANSFER_PHASE_FORM_OPEN
    return phase if phase in (TRANSFER_PHASE_IDLE, TRANSFER_PHASE_FORM_OPEN, TRANSFER_PHASE_AWAIT_CONFIRMATION) else TRANSFER_PHASE_IDLE


async def _parse_input_node(state: dict, create_chat_completion=None) -> dict:
    user_input = str(state.get("userInput") or "").strip()
    user_language = state.get("flowLanguage", "en")
    phase = state.get("phase") or TRANSFER_PHASE_IDLE
    semantic_intent = state.get("semanticIntent") or "unknown"
    transfer_intent = phase != TRANSFER_PHASE_IDLE or semantic_intent == "transfer_money"

    state = {**state, "transferIntent": transfer_intent}

    semantic_transfer = await get_semantic_transfer_payload(
        state=state,
        create_chat_completion=create_chat_completion,
    )

    if not user_input:
        return {**state, "handled": False, "reply": "", "phase": phase}

    if not transfer_intent and phase == TRANSFER_PHASE_IDLE:
        return {**state, "handled": False, "reply": "", "action": None, "phase": TRANSFER_PHASE_IDLE}

    if semantic_transfer.get("confirmation") == "no":
        return {
            **state,
            "handled": True,
            "reply": "ביטלתי את תהליך ההעברה." if user_language == "he" else "I canceled the transfer flow.",
            "action": build_reset_transfer_form_action(user_language),
            **RESET_TRANSFER_FLOW,
            "shouldRunTransfer": False,
        }

    receiver_email = state.get("receiverEmail", "")
    amount = state.get("amount")
    description = state.get("description", "")
    risk_confirmation_asked = bool(state.get("riskConfirmationAsked"))
    flow_language = state.get("flowLanguage") or user_language

    parsed_payload = None
    if semantic_transfer.get("receiverEmail") and semantic_transfer.get("amount"):
        parsed_payload = {
            "receiverEmail": semantic_transfer["receiverEmail"],
            "amount": semantic_transfer["amount"],
            "description": semantic_transfer.get("description", ""),
        }

    if parsed_payload:
        return {
            **state,
            "handled": True,
            "reply": "",
            "action": None,
            "phase": TRANSFER_PHASE_AWAIT_CONFIRMATION,
            "receiverEmail": parsed_payload["receiverEmail"],
            "amount": parsed_payload["amount"],
            "description": parsed_payload.get("description", ""),
            "riskConfirmationAsked": False,
            "flowLanguage": flow_language,
            "shouldRunTransfer": True,
        }

    if phase != TRANSFER_PHASE_IDLE and semantic_transfer.get("startNewTransfer"):
        next_lang = "he" if state.get("userLanguage") == "he" else "en"
        return {
            **state,
            "handled": True,
            "reply": "פתחתי עבורך טופס העברה חדש בתוך הצ׳אט. מלא פרטים ולחץ שלח." if next_lang == "he" else "I opened a new transfer form in the chat. Fill the details and submit.",
            "action": build_open_transfer_form_action(next_lang),
            "phase": TRANSFER_PHASE_FORM_OPEN,
            "receiverEmail": "",
            "amount": None,
            "description": "",
            "riskConfirmationAsked": False,
            "flowLanguage": next_lang,
            "shouldRunTransfer": False,
        }

    if phase == TRANSFER_PHASE_IDLE:
        flow_language = "he" if state.get("userLanguage") == "he" else "en"
        parsed_email = semantic_transfer.get("receiverEmail")
        parsed_amount = semantic_transfer.get("amount")
        parsed_description = semantic_transfer.get("description", "")

        if parsed_email and parsed_amount:
            return {
                **state,
                "handled": True,
                "reply": "",
                "action": None,
                "phase": TRANSFER_PHASE_AWAIT_CONFIRMATION,
                "receiverEmail": parsed_email,
                "amount": parsed_amount,
                "description": parsed_description,
                "riskConfirmationAsked": False,
                "flowLanguage": flow_language,
                "shouldRunTransfer": True,
            }

        if not parsed_email and parsed_amount:
            msg = "כתובת האימייל של המקבל לא תקינה. תקן את השדה ונסה שוב." if user_language == "he" else "Recipient email is invalid. Please fix the email field and try again."
            return {
                **state,
                "handled": True,
                "reply": "",
                "action": build_transfer_form_error_action("receiverEmail", msg, user_language),
                "phase": TRANSFER_PHASE_FORM_OPEN,
                "receiverEmail": "",
                "amount": parsed_amount,
                "description": parsed_description or "",
                "flowLanguage": flow_language,
                "shouldRunTransfer": False,
            }

        return {
            **state,
            "handled": True,
            "reply": "פתחתי עבורך טופס העברה קצר בתוך הצ׳אט. מלא פרטים ולחץ שלח." if user_language == "he" else "I opened a quick transfer form in the chat. Fill the details and submit.",
            "action": build_open_transfer_form_action(user_language),
            "phase": TRANSFER_PHASE_FORM_OPEN,
            "receiverEmail": "",
            "amount": None,
            "description": "",
            "riskConfirmationAsked": False,
            "flowLanguage": flow_language,
            "shouldRunTransfer": False,
        }

    if phase == TRANSFER_PHASE_FORM_OPEN:
        parsed_email = semantic_transfer.get("receiverEmail")
        parsed_amount = semantic_transfer.get("amount")
        parsed_description = semantic_transfer.get("description", "")
        missing_field = "receiverEmail" if not parsed_email else "amount"
        if missing_field == "receiverEmail":
            message = "כתובת האימייל של המקבל לא תקינה. תקן את השדה בטופס ולחץ שלח." if user_language == "he" else "Recipient email is invalid. Please fix the form field and press Send."
        else:
            message = "הסכום לא תקין. תקן את השדה בטופס ולחץ שלח." if user_language == "he" else "Amount is invalid. Please fix the form field and press Send."

        return {
            **state,
            "handled": True,
            "reply": "",
            "action": build_transfer_form_error_action(missing_field, message, user_language),
            "phase": TRANSFER_PHASE_FORM_OPEN,
            "receiverEmail": parsed_email or receiver_email,
            "amount": parsed_amount if parsed_amount is not None else amount,
            "description": parsed_description or description,
            "riskConfirmationAsked": risk_confirmation_asked,
            "flowLanguage": flow_language,
            "shouldRunTransfer": False,
        }

    if phase == TRANSFER_PHASE_AWAIT_CONFIRMATION and semantic_transfer.get("confirmation") != "yes":
        corrected_email = semantic_transfer.get("receiverEmail")
        corrected_amount = semantic_transfer.get("amount")
        corrected_description = semantic_transfer.get("description")

        if corrected_email:
            receiver_email = corrected_email
        if corrected_amount is not None:
            amount = corrected_amount
        if corrected_description:
            description = corrected_description
        if corrected_email or corrected_amount is not None or corrected_description:
            risk_confirmation_asked = False

        summary = build_transfer_confirmation_summary(
            language=user_language, amount=amount, receiver_email=receiver_email, description=description
        )

        return {
            **state,
            "handled": True,
            "reply": summary,
            "action": None,
            "phase": TRANSFER_PHASE_AWAIT_CONFIRMATION,
            "receiverEmail": receiver_email,
            "amount": amount,
            "description": description,
            "riskConfirmationAsked": risk_confirmation_asked,
            "flowLanguage": flow_language,
            "shouldRunTransfer": False,
        }

    return {
        **state,
        "handled": True,
        "reply": "",
        "action": None,
        "phase": phase,
        "receiverEmail": receiver_email,
        "amount": amount,
        "description": description,
        "riskConfirmationAsked": risk_confirmation_asked,
        "flowLanguage": flow_language,
        "shouldRunTransfer": True,
    }


async def _validate_transfer_node(state: dict, *, services: dict, user_language: str) -> dict:
    if state.get("handled") and not state.get("shouldRunTransfer"):
        return state

    try:
        profile_service = (services or {}).get("profileService")
        account_service = (services or {}).get("accountService")

        sender_user = profile_service.getUserById(str(state["userId"]))
        if not sender_user:
            return {
                **state,
                "handled": True,
                "reply": "לא הצלחתי לזהות את המשתמש המחובר." if user_language == "he" else "I could not identify the authenticated user.",
                **RESET_TRANSFER_FLOW,
                "shouldRunTransfer": False,
                "errorMessage": "sender_user_not_found",
            }

        receiver_user = profile_service.getUserByEmail(str(state.get("receiverEmail") or "").lower())
        if not receiver_user:
            msg = "המשתמש לא קיים במערכת. בדוק את כתובת האימייל ונסה שוב." if user_language == "he" else "Recipient user does not exist. Please check the email and try again."
            return {
                **state,
                "handled": True,
                "reply": "",
                "action": build_transfer_form_error_action("receiverEmail", msg, user_language),
                "phase": TRANSFER_PHASE_FORM_OPEN,
                "receiverEmail": "",
                "amount": None,
                "description": "",
                "shouldRunTransfer": False,
                "errorMessage": "receiver_user_not_found",
            }

        if str(receiver_user["_id"]) == str(sender_user["_id"]):
            msg = "אי אפשר לבצע העברה לעצמך. הזן אימייל של נמען אחר." if user_language == "he" else "You cannot transfer money to yourself. Enter a different recipient email."
            return {
                **state,
                "handled": True,
                "reply": "",
                "action": build_transfer_form_error_action("receiverEmail", msg, user_language),
                "phase": TRANSFER_PHASE_FORM_OPEN,
                "receiverEmail": "",
                "amount": None,
                "description": "",
                "shouldRunTransfer": False,
                "errorMessage": "self_transfer",
            }

        sender_account = await account_service.get_account_by_user_id(str(sender_user["_id"]))
        receiver_account = await account_service.get_account_by_user_id(str(receiver_user["_id"]))

        if not sender_account or not receiver_account:
            return {
                **state,
                "handled": True,
                "reply": "לא נמצא חשבון מקור או יעד לביצוע ההעברה." if user_language == "he" else "Source or target account was not found.",
                **RESET_TRANSFER_FLOW,
                "shouldRunTransfer": False,
                "errorMessage": "account_not_found",
            }

        requested_amount = float(state.get("amount") or 0)
        sender_balance = float(sender_account.get("balance") or 0)

        if not (requested_amount > 0 and requested_amount <= sender_balance):
            msg = (
                f"אין מספיק יתרה להעברה: ביקשת {requested_amount} ILS, יתרה זמינה {sender_balance} ILS."
                if user_language == "he"
                else f"Insufficient balance: requested {requested_amount} ILS, available {sender_balance} ILS."
            )
            return {
                **state,
                "handled": True,
                "reply": "",
                "action": build_transfer_form_error_action("amount", msg, user_language),
                "phase": TRANSFER_PHASE_FORM_OPEN,
                "receiverEmail": str(state.get("receiverEmail") or ""),
                "description": str(state.get("description") or ""),
                "amount": None,
                "shouldRunTransfer": False,
                "errorMessage": "insufficient_funds",
            }

        return {
            **state,
            "senderUser": sender_user,
            "receiverUser": receiver_user,
            "senderAccount": sender_account,
            "receiverAccount": receiver_account,
            "riskRulesAndLimits": RISK_RULES_AND_LIMITS,
            "errorMessage": None,
        }

    except Exception as err:
        return {
            **state,
            "handled": True,
            "reply": f"Transfer failed: {err}",
            **RESET_TRANSFER_FLOW,
            "shouldRunTransfer": False,
            "errorMessage": "evaluate_account_failure",
        }


async def _risk_check_node(state: dict, *, services: dict) -> dict:
    if state.get("handled") and not state.get("shouldRunTransfer"):
        return state

    user_language = state.get("flowLanguage", "en")
    amount = float(state.get("amount") or 0)
    risk_confirmation_asked = bool(state.get("riskConfirmationAsked"))

    if amount > EXTRA_CONFIRMATION_THRESHOLD and not risk_confirmation_asked:
        return {
            **state,
            "handled": True,
            "reply": "",
            "action": build_high_amount_confirm_action(user_language, amount),
            "phase": TRANSFER_PHASE_AWAIT_CONFIRMATION,
            "riskConfirmationAsked": True,
            "shouldRunTransfer": False,
        }

    risk_service = (services or {}).get("riskService")
    sender_user = state.get("senderUser") or {}
    receiver_user = state.get("receiverUser") or {}
    sender_account = state.get("senderAccount") or {}

    if risk_service:
        risk_assessment = risk_service.evaluateRisk({
            "senderEmail": str(sender_user.get("email") or "").lower(),
            "receiverEmail": str(receiver_user.get("email") or "").lower(),
            "amount": amount,
            "senderBalance": sender_account.get("balance"),
        })
    else:
        risk_assessment = {"requiresReview": False, "score": 0, "level": "LOW", "reasons": []}

    if risk_assessment.get("requiresReview"):
        reasons = ", ".join(risk_assessment.get("reasons") or []) or "Policy checks"
        return {
            **state,
            "handled": True,
            "reply": f"ההעברה סומנה בסיכון גבוה ונשלחה לבדיקה ידנית. סיבה: {reasons}." if user_language == "he" else f"This transfer was flagged as high risk and sent to manual review. Reason: {reasons}.",
            "riskAssessment": risk_assessment,
            **RESET_TRANSFER_FLOW,
            "shouldRunTransfer": False,
            "transferExecuted": False,
        }

    return {**state, "riskAssessment": risk_assessment}


async def _execute_transfer_node(state: dict, *, services: dict) -> dict:
    transaction_service = (services or {}).get("transactionService")
    user_language = state.get("flowLanguage", "en")

    try:
        if not transaction_service:
            raise ValueError("Transfer service unavailable")

        transaction = await transaction_service.execute_transfer(
            from_account_id=state["senderAccount"]["_id"],
            to_account_id=state["receiverAccount"]["_id"],
            amount=float(state["amount"]),
            description=state.get("description") or None,
        )

        updated_sender = await (services.get("accountService")).find_account_by_id(state["senderAccount"]["_id"]) if services.get("accountService") else state["senderAccount"]

        return {
            **state,
            "transferExecuted": True,
            "transactionResult": transaction,
            "senderAccount": updated_sender or state["senderAccount"],
            "reply": f"ההעברה בוצעה בהצלחה: {format_ils(state['amount'])} ILS ל־{state['receiverEmail']}." if user_language == "he" else f"Transfer completed: {format_ils(state['amount'])} ILS to {state['receiverEmail']}.",
        }
    except Exception as err:
        return {
            **state,
            "handled": True,
            "reply": f"ההעברה נכשלה: {err}" if user_language == "he" else f"Transfer failed: {err}",
            **RESET_TRANSFER_FLOW,
            "shouldRunTransfer": False,
            "transferExecuted": False,
            "errorMessage": "execute_transfer_failure",
        }


async def _build_response_node(state: dict, *, services: dict) -> dict:
    if state.get("handled") and not state.get("transferExecuted"):
        return state

    if not state.get("transferExecuted"):
        return {**state, "suggestions": []}

    language = state.get("flowLanguage", "en")
    remaining_balance = float((state.get("senderAccount") or {}).get("balance") or 0)
    suggestions = []

    low_balance_sug = build_low_balance_suggestion(language, remaining_balance)
    if low_balance_sug:
        suggestions.append(low_balance_sug)

    try:
        from datetime import datetime, timezone, timedelta
        transaction_service = (services or {}).get("transactionService")
        one_month_ago = datetime.now(timezone.utc) - timedelta(days=30)
        sender_email = str((state.get("senderUser") or {}).get("email") or "").lower()
        monthly_count = await transaction_service.count_monthly_outgoing_transfers(email=sender_email, since=one_month_ago) if transaction_service else 0
        if monthly_count >= 10:
            suggestions.append(
                "ראיתי נפח העברות גבוה בחודש האחרון. רוצה שאציע לך תקרת תקציב חודשית?" if language == "he"
                else "You had high transfer activity in the last month. Want me to suggest a monthly transfer budget cap?"
            )
    except Exception:
        pass

    return {
        **state,
        "reply": build_transfer_success_reply(
            language=language,
            amount=state.get("amount"),
            receiver_email=state.get("receiverEmail", ""),
            balance=(state.get("senderAccount") or {}).get("balance"),
            suggestions=suggestions,
        ),
        "suggestions": suggestions,
        **RESET_TRANSFER_FLOW,
        "shouldRunTransfer": False,
    }


def build_next_transfer_state(result: dict) -> dict:
    action = result.get("action") or {}
    error_message = result.get("errorMessage")
    phase = result.get("phase") or TRANSFER_PHASE_IDLE
    last_validation_error = None

    if isinstance(action, dict) and action.get("type") == "transfer_form_error":
        last_validation_error = {
            "field": action.get("field", "unknown"),
            "message": action.get("message", ""),
            "code": error_message,
        }
    elif error_message and phase != TRANSFER_PHASE_IDLE:
        last_validation_error = {
            "field": "unknown",
            "message": str(error_message),
            "code": error_message,
        }

    return {
        "phase": phase,
        "receiverEmail": result.get("receiverEmail", ""),
        "amount": result.get("amount"),
        "description": result.get("description", ""),
        "riskConfirmationAsked": bool(result.get("riskConfirmationAsked")),
        "flowLanguage": result.get("flowLanguage", ""),
        "lastValidationError": last_validation_error,
    }
