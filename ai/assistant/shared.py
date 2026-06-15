import re

MAX_HISTORY = 12


def sanitize_assistant_text(text: str) -> str:
    text = str(text or "")
    text = re.sub(r"<function[\s\S]*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"</?function[^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r'\{[\s\S]*?"name"\s*:\s*"[^"]+"[\s\S]*?\}', "", text, flags=re.IGNORECASE)
    return text.strip()


def detect_language(text: str) -> str:
    if re.search(r"[\u0590-\u05FF]", str(text or "")):
        return "he"
    return "en"


def get_llm_unavailable_reply(user_language: str) -> str:
    if user_language == "he":
        return (
            "מנוע ה־AI לא מוגדר כרגע, ולכן אני לא יכול להבין את הבקשה. "
            "צריך להגדיר OPENAI_API_KEY, GROQ_API_KEY או AI_PROVIDER=ollama עם OLLAMA_BASE_URL."
        )
    return (
        "The AI engine is not configured, so I cannot understand the request. "
        "Configure OPENAI_API_KEY, GROQ_API_KEY, or AI_PROVIDER=ollama with OLLAMA_BASE_URL."
    )


def get_llm_parse_failed_reply(user_language: str) -> str:
    if user_language == "he":
        return "קיבלתי תשובה לא תקינה ממנוע ה־AI ולא הצלחתי להבין את הבקשה. נסה שוב בעוד רגע."
    return "The AI engine returned an invalid parser response, so I could not understand the request. Please try again shortly."


def append_history(history: list, user_text: str, assistant_text: str) -> list:
    return (history + [
        {"role": "user", "content": user_text},
        {"role": "assistant", "content": assistant_text},
    ])[-MAX_HISTORY:]


def create_reply_payload(
    *,
    history: list,
    user_text: str,
    reply: str,
    transfer_state=None,
    action=None,
) -> dict:
    return {
        "reply": reply,
        "nextHistory": append_history(history, user_text, reply),
        "nextTransferState": transfer_state,
        "action": action,
    }
