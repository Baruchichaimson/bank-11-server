import asyncio

import pytest


USER_ID = "507f1f77bcf86cd799439011"
USER_EMAIL = "socket-test@example.com"


@pytest.fixture
def socket_client(monkeypatch):
    from app import create_app
    from config.settings import JWT_SECRET
    import jwt
    import realtime.socket_server as socket_server

    socket_server._user_sockets.clear()
    socket_server._pending_calls.clear()

    monkeypatch.setattr(
        socket_server,
        "find_user_by_id",
        lambda _user_id: {
            "_id": USER_ID,
            "email": USER_EMAIL,
            "firstName": "Socket",
            "isVerified": True,
            "tokenVersion": 0,
        },
    )

    flask_app = create_app(testing=True)
    sio = socket_server.init_socket_server(flask_app, flask_app)
    token = jwt.encode({"userId": USER_ID, "tokenVersion": 0}, JWT_SECRET, algorithm="HS256")
    client = sio.test_client(flask_app, auth={"token": token})
    assert client.is_connected()
    client.get_received()

    yield sio, client

    if client.is_connected():
        client.disconnect()


def _event_names(events):
    return [event["name"] for event in events]


def test_canceled_chat_request_does_not_emit_late_bot_reply(socket_client, monkeypatch):
    sio, client = socket_client
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
    client.emit("chat_message", {"requestId": request_id, "message": "hello"})
    for _ in range(100):
        if state["started"]:
            break
        sio.sleep(0.01)
    assert state["started"] is True

    client.get_received()
    client.emit("cancel_chat_message", {"requestId": request_id})
    sio.sleep(0.05)

    events = client.get_received()
    assert {"name": "chat_canceled", "args": [{"requestId": request_id}], "namespace": "/"} in events
    assert "bot_reply" not in _event_names(events)
    assert "chat_error" not in _event_names(events)

    sio.sleep(1.1)
    late_events = client.get_received()
    assert "bot_reply" not in _event_names(late_events)
    assert "chat_error" not in _event_names(late_events)
    assert state["cancelled"] is True


def test_cancelled_error_from_assistant_is_not_chat_error(socket_client, monkeypatch):
    sio, client = socket_client
    import ai.assistant.chat_assistant as chat_assistant

    async def cancelled_reply(**_kwargs):
        raise asyncio.CancelledError()

    monkeypatch.setattr(chat_assistant, "generate_assistant_reply", cancelled_reply)

    client.emit("chat_message", {"requestId": "raises-cancelled", "message": "hello"})
    sio.sleep(0.05)

    events = client.get_received()
    assert "bot_reply" not in _event_names(events)
    assert "chat_error" not in _event_names(events)
