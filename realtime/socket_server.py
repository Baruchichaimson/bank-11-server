"""
Async Socket.IO server for the Flask ASGI app.

Flask continues to serve the REST routes through WsgiToAsgi, while Socket.IO
chat work runs on the ASGI event loop with cancellable asyncio tasks.
"""

import asyncio
import os
import random
import re
import string
import sys
from datetime import datetime, timezone

import jwt
import socketio
from asgiref.wsgi import WsgiToAsgi

from config.cors_origins import get_allowed_origins
from config.settings import ACTIVE_AI_MODEL, ASSISTANT_DEBUG_ERRORS, AI_PROVIDER, IS_PRODUCTION, JWT_SECRET, SOCKET_DEBUG
from models.user_model import find_user_by_id, find_verified_user_by_email
from observability.langfuse_tracing import (
    capture_io_enabled,
    flush_langfuse,
    get_trace_fields,
    mask_email,
    now_ms,
    reset_trace_context,
    set_trace_context,
    start_trace,
    text_preview,
    trace_log,
    duration_ms,
)

AUTH_COOKIE_NAME = "access_token"
CALL_INVITE_TTL_SEC = 60

_user_sockets: dict[str, set[str]] = {}
_connection_state: dict[str, dict] = {}
_pending_calls: dict[str, dict] = {}

async_sio: socketio.AsyncServer | None = None


def _debug(*args):
    if SOCKET_DEBUG:
        print(*args)


def _log_socket(message: str):
    sys.stderr.write(f"[socket] {message}\n")
    sys.stderr.flush()


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


def _read_cookie_header(environ: dict) -> str:
    if environ.get("HTTP_COOKIE"):
        return str(environ.get("HTTP_COOKIE") or "")

    scope = environ.get("asgi.scope") or {}
    headers = scope.get("headers") or []
    for key, value in headers:
        if key.lower() == b"cookie":
            return value.decode("latin-1")
    return ""


def _cancel_active_chat_request(request_state: dict):
    request_state["cancelled"] = True
    task = request_state.get("task")
    if task and not task.done():
        task.cancel()


def _record_chat_completed(request_state: dict, *, request_id: str, success: bool, cancelled: bool, elapsed_ms=None, metadata=None):
    if request_state.get("chatCompletionEventRecorded"):
        return
    request_state["chatCompletionEventRecorded"] = True
    trace = request_state.get("trace")
    if not trace:
        return
    trace_fields = get_trace_fields()
    event_metadata = {
        "requestId": request_id,
        "selectedDomain": trace_fields.get("selected_domain"),
        "selectedIntent": trace_fields.get("selected_intent"),
        "selectedWorkflow": trace_fields.get("selected_workflow"),
        "confidence": trace_fields.get("intent_confidence"),
        "success": success,
        "cancelled": cancelled,
    }
    if elapsed_ms is not None:
        event_metadata["duration_ms"] = elapsed_ms
    event_metadata.update(metadata or {})
    trace.event(name="chat_message_completed", metadata=event_metadata)


async def _emit_to_user(event_name: str, payload: dict, to_email: str) -> int:
    if async_sio is None:
        return 0

    normalized = _normalize_email(to_email)
    sids = list(_user_sockets.get(normalized, set()))
    delivered = 0
    live: set[str] = set()

    for sid in sids:
        try:
            if async_sio.manager.is_connected(sid, "/"):
                await async_sio.emit(event_name, payload, to=sid)
                delivered += 1
                live.add(sid)
        except Exception as err:
            _log_socket(f"emit failed event={event_name} sid={sid} error={err}")

    if live:
        _user_sockets[normalized] = live
    else:
        _user_sockets.pop(normalized, None)
    return delivered


def _cancel_call_timeout(call: dict | None):
    task = (call or {}).get("timeoutTask")
    if task and not task.done():
        task.cancel()


def _start_call_timeout(call_id: str):
    async def _timeout():
        try:
            await asyncio.sleep(CALL_INVITE_TTL_SEC)
            current = _pending_calls.get(call_id)
            if not current or current.get("status") != "pending":
                return
            _pending_calls.pop(call_id, None)
            await _emit_to_user(
                "call_timeout",
                {"callId": call_id, "toEmail": current["toEmail"], "message": "Call was not answered"},
                current["fromEmail"],
            )
            await _emit_to_user(
                "call_canceled",
                {"callId": call_id, "fromEmail": current["fromEmail"]},
                current["toEmail"],
            )
        except asyncio.CancelledError:
            raise

    return asyncio.create_task(_timeout())


async def _run_chat_request(*, sid: str, request_id: str, request_state: dict, text: str, transfer_payload: dict | None):
    conn = _connection_state.get(sid)
    if not conn:
        return
    trace_tokens = set_trace_context(request_state.get("trace"), request_id=request_id)

    def is_cancelled() -> bool:
        active = conn.get("active_requests", {})
        return request_state.get("cancelled") or active.get(request_id) is not request_state

    try:
        from ai.assistant.chat_assistant import generate_assistant_reply

        start_ms = request_state.get("startMs")
        result = await generate_assistant_reply(
            user_input=text,
            user_id=conn["user"]["id"],
            user_email=_normalize_email(conn["user"]["email"]),
            history=conn["history"],
            transfer_payload=transfer_payload,
            thread_id=sid,
        )
        if is_cancelled():
            return

        conn["history"] = result.get("nextHistory") or conn["history"]

        trace_fields = get_trace_fields()
        action = result.get("action")
        action_type = action.get("type") if isinstance(action, dict) else action
        total_ms = None
        if start_ms:
            total_ms = duration_ms(start_ms)
        _record_chat_completed(
            request_state,
            request_id=request_id,
            success=True,
            cancelled=False,
            elapsed_ms=total_ms,
            metadata={"actionType": action_type},
        )
        request_state["trace"].end(
            output={
                "reply": text_preview(result.get("reply", "")),
                "selectedDomain": trace_fields.get("selected_domain"),
                "selectedIntent": trace_fields.get("selected_intent"),
                "selectedWorkflow": trace_fields.get("selected_workflow"),
                "actionType": action_type,
                "cancelled": False,
                "duration_ms": total_ms,
            },
            metadata={"cancelled": False, "duration_ms": total_ms},
        )
        trace_log(f"chat_message requestId={request_id} total_ms={total_ms:.1f}" if total_ms is not None else f"chat_message requestId={request_id} total_ms=unknown")
        _log_socket(f"bot_reply emitted requestId={request_id}")
        await async_sio.emit(
            "bot_reply",
            {
                "requestId": request_id,
                "message": result.get("reply", ""),
                "action": result.get("action"),
                "nextTransferState": result.get("nextTransferState"),
            },
            to=sid,
        )
    except asyncio.CancelledError:
        request_state["cancelled"] = True
        start_ms = request_state.get("startMs")
        _record_chat_completed(
            request_state,
            request_id=request_id,
            success=False,
            cancelled=True,
            elapsed_ms=duration_ms(start_ms) if start_ms else None,
            metadata={"cancel_reason": "task_cancelled"},
        )
        request_state["trace"].end(
            output={"cancelled": True, "cancel_reason": "task_cancelled"},
            metadata={"cancelled": True, "cancel_reason": "task_cancelled"},
        )
        raise
    except Exception as err:
        if is_cancelled():
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
        start_ms = request_state.get("startMs")
        request_state["trace"].event(
            name="error_occurred",
            metadata={
                "requestId": request_id,
                "error": err_str,
                "success": False,
                "duration_ms": duration_ms(start_ms) if start_ms else None,
            },
        )
        _record_chat_completed(
            request_state,
            request_id=request_id,
            success=False,
            cancelled=False,
            elapsed_ms=duration_ms(start_ms) if start_ms else None,
            metadata={"error": err_str},
        )
        request_state["trace"].end(
            output={"error": err_str, "cancelled": False},
            metadata={"error": err_str, "cancelled": False},
        )
        await async_sio.emit("chat_error", {"requestId": request_id, "message": msg}, to=sid)
        print(f"Socket assistant error: {err_str}")
    finally:
        reset_trace_context(trace_tokens)
        flush_langfuse()
        active = conn.get("active_requests", {})
        if active.get(request_id) is request_state:
            active.pop(request_id, None)


def create_async_socket_server() -> socketio.AsyncServer:
    global async_sio
    sio = socketio.AsyncServer(
        async_mode="asgi",
        cors_allowed_origins=get_allowed_origins(),
        async_handlers=True,
    )
    async_sio = sio

    @sio.event
    async def connect(sid, environ, auth):
        _debug("SOCKET CONNECT attempt", sid)

        auth = auth or {}
        auth_token = auth.get("token") if isinstance(auth, dict) else None
        cookie_token = _read_token_from_cookie_header(_read_cookie_header(environ))
        token = auth_token or cookie_token

        if not token:
            _debug("SOCKET AUTH FAILED", "missing_token")
            return False

        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            user = await asyncio.to_thread(find_user_by_id, payload.get("userId"))
            tv_jwt = int(payload.get("tokenVersion") or 0)
            tv_db = int((user or {}).get("tokenVersion") or 0)

            if not user or not user.get("isVerified") or tv_jwt != tv_db:
                _debug("SOCKET AUTH FAILED", "invalid_user_or_session")
                return False

            user_obj = {
                "id": str(user["_id"]),
                "email": user["email"],
                "firstName": user.get("firstName", ""),
            }
            normalized = _normalize_email(user["email"])

            sids = _user_sockets.get(normalized, set())
            sids.add(sid)
            _user_sockets[normalized] = sids

            _connection_state[sid] = {
                "user": user_obj,
                "history": [],
                "active_requests": {},
            }
            _debug("SOCKET AUTH SUCCESS", user_obj["id"])
            return True
        except Exception:
            _debug("SOCKET AUTH FAILED", "token_verification")
            return False

    @sio.event
    async def disconnect(sid):
        conn = _connection_state.pop(sid, {})
        user = conn.get("user") or {}
        normalized = _normalize_email(user.get("email", ""))

        active_requests = conn.get("active_requests", {})
        for request_state in list(active_requests.values()):
            _cancel_active_chat_request(request_state)
        active_requests.clear()

        sids = _user_sockets.get(normalized, set())
        sids.discard(sid)
        if sids:
            _user_sockets[normalized] = sids
        else:
            _user_sockets.pop(normalized, None)

        calls_to_cancel = [
            (cid, call) for cid, call in list(_pending_calls.items())
            if call.get("status") == "pending" and _normalize_email(call.get("fromEmail", "")) == normalized
        ]
        for cid, call in calls_to_cancel:
            _cancel_call_timeout(call)
            _pending_calls.pop(cid, None)
            await _emit_to_user("call_canceled", {"callId": cid, "fromEmail": call["fromEmail"]}, call["toEmail"])

    @sio.on("chat_message")
    async def on_chat_message(sid, payload):
        conn = _connection_state.get(sid)
        if not conn:
            return

        payload = payload or {}
        request_id = str(payload.get("requestId") or datetime.now(timezone.utc).timestamp())
        _log_socket(f"chat_message start sid={sid} requestId={request_id}")

        active_requests = conn["active_requests"]
        existing = active_requests.pop(request_id, None)
        if existing:
            _cancel_active_chat_request(existing)

        text = str(payload.get("message") or "").strip()
        transfer_payload = _normalize_transfer_payload(payload.get("transferPayload"))
        trace = start_trace(
            name="chat_message",
            input=text if capture_io_enabled() else text_preview(text),
            metadata={
                "requestId": request_id,
                "sid": sid,
                "userId": conn["user"]["id"],
                "userEmail": mask_email(conn["user"]["email"]),
                "messageLength": len(text),
                "hasTransferPayload": bool(transfer_payload),
                "cancelled": False,
                "environment": os.environ.get("NODE_ENV", "development"),
                "ai_provider": AI_PROVIDER,
                "model": ACTIVE_AI_MODEL,
            },
            user_id=conn["user"]["id"],
            session_id=sid,
            tags=["chatbot", "socketio"],
        )
        trace.event(
            name="user_message_received",
            input=text if capture_io_enabled() else text_preview(text),
            metadata={
                "requestId": request_id,
                "messageLength": len(text),
                "hasTransferPayload": bool(transfer_payload),
            },
        )
        request_state = {"cancelled": False, "task": None, "trace": trace, "startMs": now_ms()}
        active_requests[request_id] = request_state

        if not text:
            _log_socket(f"chat_error emitted requestId={request_id} reason=message_required")
            trace.event(
                name="validation_failed",
                metadata={
                    "requestId": request_id,
                    "reason": "message_required",
                    "missingFields": ["message"],
                    "success": False,
                },
            )
            _record_chat_completed(
                request_state,
                request_id=request_id,
                success=False,
                cancelled=False,
                elapsed_ms=duration_ms(request_state["startMs"]),
                metadata={"reason": "message_required"},
            )
            trace.end(output={"error": "Message is required", "cancelled": False})
            await sio.emit("chat_error", {"requestId": request_id, "message": "Message is required"}, to=sid)
            active_requests.pop(request_id, None)
            flush_langfuse()
            return

        if len(text) > 2000:
            _log_socket(f"chat_error emitted requestId={request_id} reason=message_too_long")
            trace.event(
                name="validation_failed",
                metadata={
                    "requestId": request_id,
                    "reason": "message_too_long",
                    "success": False,
                    "messageLength": len(text),
                },
            )
            _record_chat_completed(
                request_state,
                request_id=request_id,
                success=False,
                cancelled=False,
                elapsed_ms=duration_ms(request_state["startMs"]),
                metadata={"reason": "message_too_long"},
            )
            trace.end(output={"error": "Message is too long", "cancelled": False})
            await sio.emit("chat_error", {"requestId": request_id, "message": "Message is too long"}, to=sid)
            active_requests.pop(request_id, None)
            flush_langfuse()
            return

        task = asyncio.create_task(
            _run_chat_request(
                sid=sid,
                request_id=request_id,
                request_state=request_state,
                text=text,
                transfer_payload=transfer_payload,
            )
        )
        request_state["task"] = task

    @sio.on("cancel_chat_message")
    async def on_cancel_chat_message(sid, payload):
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

        _cancel_active_chat_request(request_state)
        _log_socket(f"request canceled requestId={request_id}")
        trace = request_state.get("trace")
        if trace:
            start_ms = request_state.get("startMs")
            _record_chat_completed(
                request_state,
                request_id=request_id,
                success=False,
                cancelled=True,
                elapsed_ms=duration_ms(start_ms) if start_ms else None,
                metadata={"cancel_reason": "user_cancel"},
            )
            trace.end(
                output={"requestId": request_id, "cancelled": True, "cancel_reason": "user_cancel"},
                metadata={"cancelled": True, "cancel_reason": "user_cancel"},
            )
        trace_log(f"chat_message requestId={request_id} cancelled=true cancel_reason=user_cancel")
        await sio.emit("chat_canceled", {"requestId": request_id}, to=sid)
        flush_langfuse()

    @sio.on("call_request")
    async def on_call_request(sid, payload):
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

            recipient = await asyncio.to_thread(find_verified_user_by_email, to_email)
            if not recipient:
                return {"ok": False, "message": "Recipient not found or not verified"}

            call_id = (
                f"{int(datetime.now(timezone.utc).timestamp() * 1000)}-"
                f"{sid}-{''.join(random.choices(string.ascii_lowercase + string.digits, k=6))}"
            )
            room_name = _build_room_name(from_email, to_email)

            delivered = await _emit_to_user(
                "call_incoming",
                {
                    "callId": call_id,
                    "fromEmail": from_email,
                    "fromName": conn["user"]["firstName"],
                    "roomName": room_name,
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                },
                to_email,
            )

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
            _pending_calls[call_id] = call_payload
            call_payload["timeoutTask"] = _start_call_timeout(call_id)

            return {"ok": True, "callId": call_id, "roomName": room_name, "toEmail": to_email}

        except Exception as exc:
            import traceback
            tb = traceback.format_exc()
            print(f"[call_request] EXCEPTION: {exc}", flush=True)
            print(tb, flush=True)
            try:
                with open("/tmp/call_error.log", "w") as f:
                    f.write(f"EXCEPTION: {exc}\n{tb}\n")
            except Exception:
                pass
            return {"ok": False, "message": "Could not start the call"}

    @sio.on("call_accept")
    async def on_call_accept(sid, payload):
        conn = _connection_state.get(sid)
        if not conn:
            return {"ok": False, "message": "Not connected"}

        call_id = str((payload or {}).get("callId") or "")
        call = _pending_calls.get(call_id)

        if not call or call.get("status") != "pending":
            return {"ok": False, "message": "Call is no longer available"}

        if _normalize_email(call["toEmail"]) != _normalize_email(conn["user"]["email"]):
            return {"ok": False, "message": "Not authorized for this call"}

        await _emit_to_user(
            "call_accepted",
            {"callId": call_id, "roomName": call["roomName"], "peerEmail": call["toEmail"]},
            call["fromEmail"],
        )
        await _emit_to_user(
            "call_accepted",
            {"callId": call_id, "roomName": call["roomName"], "peerEmail": call["fromEmail"]},
            call["toEmail"],
        )

        _cancel_call_timeout(call)
        _pending_calls.pop(call_id, None)

        return {"ok": True, "callId": call_id, "roomName": call["roomName"], "peerEmail": call["fromEmail"]}

    @sio.on("call_decline")
    async def on_call_decline(sid, payload):
        conn = _connection_state.get(sid)
        if not conn:
            return
        call_id = str((payload or {}).get("callId") or "")
        call = _pending_calls.get(call_id)
        if not call or call.get("status") != "pending":
            return
        if _normalize_email(call["toEmail"]) != _normalize_email(conn["user"]["email"]):
            return

        call["status"] = "declined"
        await _emit_to_user("call_declined", {"callId": call_id, "byEmail": call["toEmail"]}, call["fromEmail"])
        await _emit_to_user("call_canceled", {"callId": call_id, "fromEmail": call["fromEmail"]}, call["toEmail"])
        _cancel_call_timeout(call)
        _pending_calls.pop(call_id, None)

    @sio.on("call_cancel")
    async def on_call_cancel(sid, payload):
        conn = _connection_state.get(sid)
        if not conn:
            return
        call_id = str((payload or {}).get("callId") or "")
        call = _pending_calls.get(call_id)
        if not call or call.get("status") != "pending":
            return
        if _normalize_email(call["fromEmail"]) != _normalize_email(conn["user"]["email"]):
            return

        call["status"] = "canceled"
        await _emit_to_user("call_canceled", {"callId": call_id, "fromEmail": call["fromEmail"]}, call["toEmail"])
        _cancel_call_timeout(call)
        _pending_calls.pop(call_id, None)

    return sio


def create_socket_asgi_app(flask_app):
    _connection_state.clear()
    _user_sockets.clear()
    _pending_calls.clear()
    sio = create_async_socket_server()
    flask_asgi_app = WsgiToAsgi(flask_app)
    return socketio.ASGIApp(sio, other_asgi_app=flask_asgi_app)


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
