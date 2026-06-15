from ai.assistant.shared import MAX_HISTORY, append_history


def create_reply_payload(*, history, user_text, reply, transfer_state=None, action=None) -> dict:
    return {
        "reply": reply,
        "nextHistory": append_history(history, user_text, reply),
        "nextTransferState": transfer_state,
        "action": action,
    }


def get_window_tool_reply(tool_name: str, user_language: str) -> str:
    if tool_name == "open_video_call_window":
        return "פתחתי עבורך את חלון שיחת הווידאו." if user_language == "he" else "I opened the video call window for you."
    if tool_name == "open_money_transfer_inline":
        return "פתחתי עבורך טופס העברה קצר בתוך הצ׳אט." if user_language == "he" else "I opened a quick transfer form in the chat."
    return ""


def get_window_tool_action(tool_name: str, tool_result) -> dict | str | None:
    if tool_name == "open_video_call_window":
        return tool_result.get("action") if isinstance(tool_result, dict) else "open_video_call"
    if tool_name == "open_money_transfer_inline":
        if isinstance(tool_result, dict) and isinstance(tool_result.get("action"), dict):
            return tool_result["action"]
        return {"type": "open_money_transfer_inline"}
    return None
