import asyncio

import pytest


USER_ID = "507f1f77bcf86cd799439011"
USER_EMAIL = "socket-test@example.com"


@pytest.fixture
def async_socket_server(monkeypatch):
    import realtime.socket_server as socket_server

    socket_server._connection_state.clear()
    socket_server._user_sockets.clear()
    socket_server._pending_calls.clear()
    socket_server.async_sio = socket_server.create_async_socket_server()

    sid = "test-sid"
    socket_server._connection_state[sid] = {
        "user": {"id": USER_ID, "email": USER_EMAIL, "firstName": "Socket"},
        "history": [],
        "active_requests": {},
    }

    events = []

    async def fake_emit(event, data=None, to=None, **_kwargs):
        events.append({"name": event, "args": [data], "to": to})

    monkeypatch.setattr(socket_server.async_sio, "emit", fake_emit)

    yield socket_server, sid, events

    conn = socket_server._connection_state.get(sid, {})
    for request_state in list((conn.get("active_requests") or {}).values()):
        task = request_state.get("task")
        if task and not task.done():
            task.cancel()


def _event_names(events):
    return [event["name"] for event in events]


@pytest.mark.asyncio
async def test_canceled_chat_request_does_not_emit_late_bot_reply(async_socket_server, monkeypatch):
    socket_server, sid, events = async_socket_server
    import ai.assistant.chat_assistant as chat_assistant

    state = {"started": False, "cancelled": False}

    async def slow_reply(**_kwargs):
        state["started"] = True
        try:
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            state["cancelled"] = True
            raise
        return {
            "reply": "late reply",
            "nextHistory": [{"role": "assistant", "content": "late reply"}],
            "nextTransferState": None,
            "action": None,
        }

    monkeypatch.setattr(chat_assistant, "generate_assistant_reply", slow_reply)

    request_id = "cancel-me"
    chat_handler = socket_server.async_sio.handlers["/"]["chat_message"]
    cancel_handler = socket_server.async_sio.handlers["/"]["cancel_chat_message"]

    await chat_handler(sid, {"requestId": request_id, "message": "hello"})
    for _ in range(100):
        if state["started"]:
            break
        await asyncio.sleep(0.01)
    assert state["started"] is True

    events.clear()
    await cancel_handler(sid, {"requestId": request_id})
    await asyncio.sleep(0.05)

    assert {"name": "chat_canceled", "args": [{"requestId": request_id}], "to": sid} in events
    assert "bot_reply" not in _event_names(events)
    assert "chat_error" not in _event_names(events)

    await asyncio.sleep(1.1)
    assert "bot_reply" not in _event_names(events)
    assert "chat_error" not in _event_names(events)
    assert state["cancelled"] is True


@pytest.mark.asyncio
async def test_cancelled_error_from_assistant_is_not_chat_error(async_socket_server, monkeypatch):
    socket_server, sid, events = async_socket_server
    import ai.assistant.chat_assistant as chat_assistant

    async def cancelled_reply(**_kwargs):
        raise asyncio.CancelledError()

    monkeypatch.setattr(chat_assistant, "generate_assistant_reply", cancelled_reply)

    chat_handler = socket_server.async_sio.handlers["/"]["chat_message"]
    await chat_handler(sid, {"requestId": "raises-cancelled", "message": "hello"})
    await asyncio.sleep(0.05)

    assert "bot_reply" not in _event_names(events)
    assert "chat_error" not in _event_names(events)
