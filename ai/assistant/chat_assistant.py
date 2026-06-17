"""
Chat assistant — port of chatAssistant.js.
"""

import asyncio
import sys
import traceback

from ai.assistant.openai_client import openai_client, OPENAI_MODEL, has_openai_key
from ai.graph.banking_graph import run_banking_graph
from ai.services.business_services import create_business_services
from ai.assistant.shared import MAX_HISTORY, detect_language, create_reply_payload


async def _create_chat_completion(payload: dict):
    """Async wrapper around the OpenAI (compatible) chat completion call."""
    kwargs = {k: v for k, v in payload.items() if k not in ("abortSignal",)}
    if "model" not in kwargs:
        kwargs["model"] = OPENAI_MODEL
    return await openai_client.chat.completions.create(**kwargs)


async def generate_assistant_reply(
    *,
    user_input: str,
    user_id: str,
    user_email: str = None,
    history: list = None,
    transfer_payload: dict = None,
    abort_signal=None,
    thread_id: str = None,
) -> dict:
    trimmed = str(user_input or "").strip()
    user_language = detect_language(trimmed)

    if not trimmed:
        reply = "אנא כתוב הודעה כדי שאוכל לעזור." if user_language == "he" else "Please type a message so I can help."
        return {
            "reply": reply,
            "nextHistory": history or [],
            "nextTransferState": None,
            "action": None,
        }

    short_history = (history or [])[-MAX_HISTORY:]
    services = create_business_services()

    chat_completion_fn = _create_chat_completion if (has_openai_key and openai_client) else None

    try:
        return await run_banking_graph(
            user_input=trimmed,
            user_id=user_id,
            user_email=user_email,
            history=short_history,
            transfer_payload=transfer_payload,
            create_chat_completion=chat_completion_fn,
            services=services,
            abort_signal=abort_signal,
            thread_id=thread_id,
        )
    except asyncio.CancelledError:
        raise
    except Exception as err:
        sys.stderr.write(f"[chat_assistant] ERROR in run_banking_graph: {err}\n")
        sys.stderr.write(traceback.format_exc())
        sys.stderr.flush()
        fallback_reply = (
            "יש כרגע תקלה זמנית בעוזר. נסה שוב בעוד כמה שניות."
            if user_language == "he"
            else "The assistant is temporarily unavailable. Please try again in a few seconds."
        )
        return create_reply_payload(
            history=short_history,
            user_text=trimmed,
            reply=fallback_reply,
            transfer_state=None,
            action=None,
        )
