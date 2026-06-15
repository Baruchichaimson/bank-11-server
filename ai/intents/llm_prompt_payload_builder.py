from datetime import datetime, timezone

MAX_CONTEXT_MESSAGES = 6
MAX_CONTEXT_CHARS = 700
DEFAULT_ASSISTANT_TIME_ZONE = "Asia/Jerusalem"


def get_current_date_for_prompt() -> str:
    try:
        import pytz
        tz = pytz.timezone(DEFAULT_ASSISTANT_TIME_ZONE)
        now = datetime.now(tz)
    except Exception:
        now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%d")


def sanitize_history_for_prompt(history: list) -> list:
    if not isinstance(history, list):
        return []
    result = []
    for item in history[-MAX_CONTEXT_MESSAGES:]:
        role = item.get("role")
        role = "assistant" if role == "assistant" else "user"
        content = str(item.get("content") or "").strip()[:MAX_CONTEXT_CHARS]
        if content:
            result.append({"role": role, "content": content})
    return result


def build_user_prompt_payload(*, user_input: str, history: list) -> dict:
    return {
        "currentDate": get_current_date_for_prompt(),
        "timeZone": DEFAULT_ASSISTANT_TIME_ZONE,
        "currentUserMessage": str(user_input or "").strip(),
        "recentConversation": sanitize_history_for_prompt(history),
    }
