"""
Socket.IO server — port of socketServer.js.

Uses Flask-SocketIO (eventlet/gevent async mode).
Each chat request runs on a dedicated asyncio loop in a background greenlet so
the Socket.IO cancel event can cancel the running asyncio task.
"""

import re
import sys
import threading
from datetime import datetime, timezone

import jwt
from flask_socketio import SocketIO, disconnect

from config.settings import JWT_SECRET, SOCKET_DEBUG, ASSISTANT_DEBUG_ERRORS, IS_PRODUCTION
from config.cors_origins import get_allowed_origins
from models.user_model import find_user_by_id, find_verified_user_by_email

AUTH_COOKIE_NAME = "access_token"
CALL_INVITE_TTL_SEC = 60

_user_sockets: dict[str, set] = {}
_pending_calls: dict[str, dict] = {}
_lock = threading.Lock()

socketio: SocketIO | None = None


def _debug(*args):
    if SOCKET_DEBUG:
        print(*args)


def _log_socket(message: str):
    sys.stderr.write(f"[socket] {message}\n")
    sys.stderr.flush()


def _cancel_active_chat_request(request_state: dict, *, request_id: str):
    request_state["cancelled"] = True
    task = request_state.get("task")
    loop = request_state.get("loop")
    scheduled_task_cancel = False

    if task is not None and loop is not None and not task.done():
        try:
            loop.call_soon_threadsafe(task.cancel)
            scheduled_task_cancel = True
        except RuntimeError:
            scheduled_task_cancel = False

    if scheduled_task_cancel:
        return

    greenlet = request_state.get("greenlet")
    if greenlet is None or not hasattr(greenlet, "kill"):
        return

    try:
        is_ready = greenlet.ready() if hasattr(greenlet, "ready") else False
        if not is_ready:
            greenlet.kill(block=False)
    except TypeError:
        greenlet.kill()
    except Exception as err:
        _log_socket(f"request cancel fallback failed requestId={request_id} error={err}")


def _normalize_email(value: str) -> str:
    return str(value or "").strip().lower()


def _sanitize_for_room(value: str) -> str:
    value = re.sub(r"[^a-z0-9]", "-", value)
    value = re.sub(r"-+", "-", value)
    return value.strip("-")


def _build_room_name(email_a: str, email_b: str) -> str:
    pair = sorted([_normalize_email(email_a), _normalize_email(email_b)])
    room = f"bank11-{_sanitize_for_room(pair[0])}-{_sanitize_for_room(pair[1])}"
    return room[:120]


def _read_token_from_cookie_header(cookie_header: str) -> str | None:
    raw = str(cookie_header or "")
    for part in raw.split(";"):
        k, _, v = part.strip().partition("=")
        if k.strip() == AUTH_COOKIE_NAME:
            from urllib.parse import unquote
            return unquote(v)
    return None


def _emit_to_user(sid_map, event_name: str, payload: dict, to_email: str):
    normalized = _normalize_email(to_email)
    with _lock:
        sids = _user_sockets.get(normalized, set())
        live = [s for s in sids if socketio.server.manager.is_connected(s, '/')]
        if not live:
            _user_sockets.pop(normalized, None)
            return 0
        _user_sockets[normalized] = set(live)
    for sid in live:
        socketio.emit(event_name, payload, to=sid)
    return len(live)


def init_socket_server(app, flask_app) -> SocketIO:
    global socketio
    socketio = SocketIO(
        app,
        cors_allowed_origins=get_allowed_origins(),
        async_mode="gevent",
        manage_session=False,
    )

    # Per-connection state stored in a plain dict keyed by sid.
    _connection_state: dict[str, dict] = {}

    @socketio.on("connect")
    def on_connect(auth):
        from flask import request as freq
        _debug("SOCKET CONNECT attempt", freq.sid)

        auth = auth or {}
        auth_token = auth.get("token")
        cookie_token = _read_token_from_cookie_header(freq.headers.get("Cookie", ""))
        token = auth_token or cookie_token

        if not token:
            _debug("SOCKET AUTH FAILED", "missing_token")
            disconnect()
            return False

        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            user = find_user_by_id(payload.get("userId"))
            tv_jwt = int(payload.get("tokenVersion") or 0)
            tv_db = int((user or {}).get("tokenVersion") or 0)

            if not user or not user.get("isVerified") or tv_jwt != tv_db:
                _debug("SOCKET AUTH FAILED", "invalid_user_or_session")
                disconnect()
                return False

            sid = freq.sid
            user_obj = {
                "id": str(user["_id"]),
                "email": user["email"],
                "firstName": user.get("firstName", ""),
            }
            normalized = _normalize_email(user["email"])

            with _lock:
                sids = _user_sockets.get(normalized, set())
                sids.add(sid)
                _user_sockets[normalized] = sids

            _connection_state[sid] = {
                "user": user_obj,
                "history": [],
                "active_requests": {},  # requestId -> request state dict
            }
            _debug("SOCKET AUTH SUCCESS", user_obj["id"])

        except Exception:
            _debug("SOCKET AUTH FAILED", "token_verification")
            disconnect()
            return False

    @socketio.on("disconnect")
    def on_disconnect():
        from flask import request as freq
        sid = freq.sid
        conn = _connection_state.pop(sid, {})
        user = conn.get("user") or {}
        normalized = _normalize_email(user.get("email", ""))

        # cancel all active chat requests
        active_requests = conn.get("active_requests", {})
        for request_id, request_state in list(active_requests.items()):
            _cancel_active_chat_request(request_state, request_id=request_id)
        active_requests.clear()

        with _lock:
            sids = _user_sockets.get(normalized, set())
            sids.discard(sid)
            if not sids:
                _user_sockets.pop(normalized, None)
            else:
                _user_sockets[normalized] = sids

        # cancel pending calls initiated by this user
        with _lock:
            calls_to_cancel = [
                (cid, call) for cid, call in list(_pending_calls.items())
                if call.get("status") == "pending" and _normalize_email(call.get("fromEmail", "")) == normalized
            ]
        for cid, call in calls_to_cancel:
            with _lock:
                _pending_calls.pop(cid, None)
            _emit_to_user(None, "call_canceled", {"callId": cid, "fromEmail": call["fromEmail"]}, call["toEmail"])

    @socketio.on("chat_message")
    def on_chat_message(payload):
        import asyncio
        from flask import request as freq
        sid = freq.sid
        conn = _connection_state.get(sid)
        if not conn:
            return

        payload = payload or {}
        request_id = str(payload.get("requestId") or datetime.now(timezone.utc).timestamp())
        _log_socket(f"chat_message start sid={sid} requestId={request_id}")

        existing = conn["active_requests"].pop(request_id, None)
        if existing:
            _cancel_active_chat_request(existing, request_id=request_id)

        request_state = {
            "cancelled": False,
            "loop": None,
            "task": None,
            "greenlet": None,
        }
        conn["active_requests"][request_id] = request_state

        text = str(payload.get("message") or "").strip()
        if not text:
            _log_socket(f"chat_error emitted requestId={request_id} reason=message_required")
            socketio.emit("chat_error", {"requestId": request_id, "message": "Message is required"}, to=sid)
            conn["active_requests"].pop(request_id, None)
            return

        if len(text) > 2000:
            _log_socket(f"chat_error emitted requestId={request_id} reason=message_too_long")
            socketio.emit("chat_error", {"requestId": request_id, "message": "Message is too long"}, to=sid)
            conn["active_requests"].pop(request_id, None)
            return

        transfer_payload = _normalize_transfer_payload(payload.get("transferPayload"))

        def _is_cancelled() -> bool:
            return request_state.get("cancelled") or conn["active_requests"].get(request_id) is not request_state

        async def _run():
            from ai.assistant.chat_assistant import generate_assistant_reply
            try:
                result = await generate_assistant_reply(
                    user_input=text,
                    user_id=conn["user"]["id"],
                    user_email=_normalize_email(conn["user"]["email"]),
                    history=conn["history"],
                    transfer_payload=transfer_payload,
                    thread_id=sid,
                )
                if _is_cancelled():
                    return

                conn["history"] = result.get("nextHistory") or conn["history"]

                _log_socket(f"bot_reply emitted requestId={request_id}")
                socketio.emit("bot_reply", {
                    "requestId": request_id,
                    "message": result.get("reply", ""),
                    "action": result.get("action"),
                    "nextTransferState": result.get("nextTransferState"),
                }, to=sid)
            except asyncio.CancelledError:
                request_state["cancelled"] = True
                raise
            except Exception as err:
                if _is_cancelled():
                    return
                err_str = str(err)
                if "abort" in err_str.lower():
                    return
                msg = (
                    "Assistant is temporarily unavailable"
                    if IS_PRODUCTION and not ASSISTANT_DEBUG_ERRORS
                    else f"Assistant error: {err_str}"
                )
                _log_socket(f"chat_error emitted requestId={request_id} error={err_str}")
                socketio.emit("chat_error", {"requestId": request_id, "message": msg}, to=sid)
                print(f"Socket assistant error: {err_str}")
            finally:
                if conn["active_requests"].get(request_id) is request_state:
                    conn["active_requests"].pop(request_id, None)

        def _run_background():
            loop = asyncio.new_event_loop()
            request_state["loop"] = loop
            asyncio.set_event_loop(loop)
            try:
                if request_state["cancelled"]:
                    return
                task = loop.create_task(_run())
                request_state["task"] = task
                loop.run_until_complete(task)
            except asyncio.CancelledError:
                request_state["cancelled"] = True
            finally:
                if conn["active_requests"].get(request_id) is request_state:
                    conn["active_requests"].pop(request_id, None)
                request_state["task"] = None
                request_state["loop"] = None
                asyncio.set_event_loop(None)
                loop.close()

        request_state["greenlet"] = socketio.start_background_task(_run_background)

    @socketio.on("cancel_chat_message")
    def on_cancel_chat_message(payload):
        from flask import request as freq
        sid = freq.sid
        conn = _connection_state.get(sid)
        if not conn:
            return
        request_id = str((payload or {}).get("requestId") or "")
        if not request_id:
            return
        request_state = conn["active_requests"].pop(request_id, None)
        if not request_state:
            _log_socket(f"request cancel ignored requestId={request_id} reason=not_found")
            return
        _cancel_active_chat_request(request_state, request_id=request_id)
        _log_socket(f"request canceled requestId={request_id}")
        socketio.emit("chat_canceled", {"requestId": request_id}, to=sid)

    @socketio.on("call_request")
    def on_call_request(payload):
        from flask import request as freq
        sid = freq.sid
        conn = _connection_state.get(sid)
        if not conn:
            return {"ok": False, "message": "Not connected"}

        try:
            to_email = _normalize_email((payload or {}).get("toEmail", ""))
            from_email = _normalize_email(conn["user"]["email"])

            if not to_email or "@" not in to_email:
                return {"ok": False, "message": "Invalid recipient email"}

            if to_email == from_email:
                return {"ok": False, "message": "Cannot call your own email"}

            recipient = find_verified_user_by_email(to_email)
            if not recipient:
                return {"ok": False, "message": "Recipient not found or not verified"}

            import random
            import string
            call_id = f"{int(datetime.now(timezone.utc).timestamp() * 1000)}-{sid}-{''.join(random.choices(string.ascii_lowercase + string.digits, k=6))}"
            room_name = _build_room_name(from_email, to_email)

            delivered = _emit_to_user(None, "call_incoming", {
                "callId": call_id,
                "fromEmail": from_email,
                "fromName": conn["user"]["firstName"],
                "roomName": room_name,
                "createdAt": datetime.now(timezone.utc).isoformat(),
            }, to_email)

            if delivered == 0:
                return {"ok": False, "message": "Recipient is offline right now"}

            call_payload = {
                "callId": call_id,
                "roomName": room_name,
                "fromEmail": from_email,
                "toEmail": to_email,
                "createdAt": datetime.now(timezone.utc).timestamp() * 1000,
                "fromName": conn["user"]["firstName"],
                "status": "pending",
            }
            with _lock:
                _pending_calls[call_id] = call_payload

            def _timeout():
                with _lock:
                    current = _pending_calls.get(call_id)
                if not current or current.get("status") != "pending":
                    return
                with _lock:
                    _pending_calls.pop(call_id, None)
                _emit_to_user(None, "call_timeout", {"callId": call_id, "toEmail": to_email, "message": "Call was not answered"}, from_email)
                _emit_to_user(None, "call_canceled", {"callId": call_id, "fromEmail": from_email}, to_email)

            t = threading.Timer(CALL_INVITE_TTL_SEC, _timeout)
            t.daemon = True
            t.start()

            return {"ok": True, "callId": call_id, "roomName": room_name, "toEmail": to_email}

        except Exception as _exc:
            import traceback
            _tb = traceback.format_exc()
            print(f"[call_request] EXCEPTION: {_exc}", flush=True)
            print(_tb, flush=True)
            try:
                with open("/tmp/call_error.log", "w") as _f:
                    _f.write(f"EXCEPTION: {_exc}\n{_tb}\n")
            except Exception:
                pass
            return {"ok": False, "message": "Could not start the call"}

    @socketio.on("call_accept")
    def on_call_accept(payload):
        from flask import request as freq
        sid = freq.sid
        conn = _connection_state.get(sid)
        if not conn:
            return {"ok": False, "message": "Not connected"}

        call_id = str((payload or {}).get("callId") or "")
        with _lock:
            call = _pending_calls.get(call_id)

        if not call or call.get("status") != "pending":
            return {"ok": False, "message": "Call is no longer available"}

        if _normalize_email(call["toEmail"]) != _normalize_email(conn["user"]["email"]):
            return {"ok": False, "message": "Not authorized for this call"}

        _emit_to_user(None, "call_accepted", {"callId": call_id, "roomName": call["roomName"], "peerEmail": call["toEmail"]}, call["fromEmail"])
        _emit_to_user(None, "call_accepted", {"callId": call_id, "roomName": call["roomName"], "peerEmail": call["fromEmail"]}, call["toEmail"])

        with _lock:
            _pending_calls.pop(call_id, None)

        return {"ok": True, "callId": call_id, "roomName": call["roomName"], "peerEmail": call["fromEmail"]}

    @socketio.on("call_decline")
    def on_call_decline(payload):
        from flask import request as freq
        conn = _connection_state.get(freq.sid)
        if not conn:
            return
        call_id = str((payload or {}).get("callId") or "")
        with _lock:
            call = _pending_calls.get(call_id)
        if not call or call.get("status") != "pending":
            return
        if _normalize_email(call["toEmail"]) != _normalize_email(conn["user"]["email"]):
            return

        call["status"] = "declined"
        _emit_to_user(None, "call_declined", {"callId": call_id, "byEmail": call["toEmail"]}, call["fromEmail"])
        _emit_to_user(None, "call_canceled", {"callId": call_id, "fromEmail": call["fromEmail"]}, call["toEmail"])
        with _lock:
            _pending_calls.pop(call_id, None)

    @socketio.on("call_cancel")
    def on_call_cancel(payload):
        from flask import request as freq
        conn = _connection_state.get(freq.sid)
        if not conn:
            return
        call_id = str((payload or {}).get("callId") or "")
        with _lock:
            call = _pending_calls.get(call_id)
        if not call or call.get("status") != "pending":
            return
        if _normalize_email(call["fromEmail"]) != _normalize_email(conn["user"]["email"]):
            return

        call["status"] = "canceled"
        _emit_to_user(None, "call_canceled", {"callId": call_id, "fromEmail": call["fromEmail"]}, call["toEmail"])
        with _lock:
            _pending_calls.pop(call_id, None)

    return socketio


def _normalize_transfer_payload(value) -> dict | None:
    if not value or not isinstance(value, dict) or isinstance(value, list):
        return None
    return {
        "receiverEmail": value.get("receiverEmail") if isinstance(value.get("receiverEmail"), str) else None,
        "amount": value.get("amount"),
        "description": value.get("description") if isinstance(value.get("description"), str) else None,
        "confirmation": value.get("confirmation") if value.get("confirmation") in ("yes", "no") else None,
        "skipDescription": bool(value.get("skipDescription")),
        "startNewTransfer": bool(value.get("startNewTransfer")),
    }
