"""
AI service facade — exposes generate_assistant_reply to the rest of the app.
"""

from ai.assistant.chat_assistant import generate_assistant_reply

__all__ = ["generate_assistant_reply"]
