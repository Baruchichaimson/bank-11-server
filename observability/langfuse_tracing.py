"""
Langfuse tracing helpers.

All functions are safe no-ops when Langfuse is disabled, not installed, or
misconfigured. Call sites should never need to guard tracing code.
"""

from __future__ import annotations

import contextvars
import os
import re
import sys
import time
from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal
from types import TracebackType
from typing import Optional
from uuid import UUID

try:
    from bson import ObjectId
except Exception:  # pragma: no cover
    ObjectId = None

_client = None
_client_failed = False
_current_trace = contextvars.ContextVar("current_langfuse_trace", default=None)
_current_observation = contextvars.ContextVar("current_langfuse_observation", default=None)
_current_request_id = contextvars.ContextVar("current_trace_request_id", default=None)
_trace_fields = contextvars.ContextVar("current_trace_fields", default=None)

SENSITIVE_KEY_RE = re.compile(
    r"(password|jwt|access[_-]?token|refresh[_-]?token|reset[_-]?token|secret|api[_-]?key|authorization|cookie)",
    re.IGNORECASE,
)
EMAIL_RE = re.compile(r"([^@\s]+)@([^@\s]+\.[^@\s]+)")
MONEY_RE = re.compile(
    r"(?i)(?:[$₪]\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:ils|nis|usd|eur|gbp|₪|שח))"
)
LONG_NUMBER_RE = re.compile(r"\b\d{8,}\b")


def _env_bool(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).strip().lower() == "true"


def capture_io_enabled() -> bool:
    return _env_bool("LANGFUSE_CAPTURE_IO")


def trace_logs_enabled() -> bool:
    return _env_bool("ASSISTANT_TRACE_LOGS")


def is_langfuse_enabled() -> bool:
    return (
        _env_bool("LANGFUSE_ENABLED")
        and bool(os.environ.get("LANGFUSE_PUBLIC_KEY"))
        and bool(os.environ.get("LANGFUSE_SECRET_KEY"))
    )


def configure_langfuse_environment():
    """Bridge this app's LANGFUSE_ENABLED flag to the SDK's tracing flag."""
    os.environ.setdefault("LANGFUSE_TRACING_ENABLED", "true" if is_langfuse_enabled() else "false")


def get_request_id() -> str | None:
    return _current_request_id.get()


def trace_log(message: str):
    if not trace_logs_enabled():
        return
    sys.stderr.write(f"[trace] {message}\n")
    sys.stderr.flush()


def now_ms() -> float:
    return time.perf_counter() * 1000


def duration_ms(start_ms: float) -> float:
    return max(now_ms() - start_ms, 0)


def mask_email(value: str) -> str:
    text = str(value or "")
    if capture_io_enabled():
        return text

    def repl(match):
        local = match.group(1)
        domain = match.group(2)
        if not local:
            return f"***@{domain}"
        return f"{local[:1]}***@{domain}"

    return EMAIL_RE.sub(repl, text)


def _sanitize_text(value: str) -> str:
    text = mask_email(value)
    if capture_io_enabled():
        return text
    text = MONEY_RE.sub("[amount]", text)
    return LONG_NUMBER_RE.sub("[number]", text)


def text_preview(value, *, max_chars=160) -> dict:
    text = str(value or "")
    preview = text if capture_io_enabled() else text[:max_chars]
    return {"preview": _sanitize_text(preview), "length": len(text)}


def _sanitize_mapping(value: Mapping, *, depth: int):
    output = {}
    for key, item in value.items():
        key_str = str(key)
        if SENSITIVE_KEY_RE.search(key_str):
            output[key_str] = "[redacted]"
            continue

        if not capture_io_enabled() and key_str in {
            "account",
            "accountSummary",
            "senderAccount",
            "receiverAccount",
            "fullAccount",
        }:
            output[key_str] = _summarize_account(item)
            continue

        if not capture_io_enabled() and key_str in {"transactions", "items", "transactionList"} and isinstance(item, list):
            output[key_str] = {"count": len(item)}
            continue

        if not capture_io_enabled() and key_str in {"transferPayload", "transfer_payload"}:
            output[key_str] = _summarize_transfer_payload(item)
            continue

        output[key_str] = sanitize_for_trace(item, _depth=depth + 1)
    return output


def _summarize_account(value):
    if not isinstance(value, Mapping):
        return {"present": bool(value)}
    return {
        "present": True,
        "status": value.get("status"),
        "currency": value.get("currency"),
        "hasBalance": value.get("balance") is not None,
        **({"balance": value.get("balance")} if capture_io_enabled() else {}),
    }


def _summarize_transfer_payload(value):
    if not isinstance(value, Mapping):
        return {"present": bool(value)}
    return {
        "present": True,
        "hasReceiverEmail": bool(value.get("receiverEmail")),
        "hasAmount": value.get("amount") is not None,
        "hasDescription": bool(value.get("description")),
        "confirmation": value.get("confirmation"),
    }


def sanitize_for_trace(value, *, _depth: int = 0):
    if _depth > 8:
        return "[max_depth]"

    if value is None or isinstance(value, (bool, int, float)):
        return value

    if isinstance(value, str):
        if SENSITIVE_KEY_RE.search(value):
            return "[redacted]"
        return _sanitize_text(value if capture_io_enabled() else value[:500])

    if ObjectId is not None and isinstance(value, ObjectId):
        return str(value)

    if isinstance(value, (datetime, date)):
        return value.isoformat()

    if isinstance(value, Decimal):
        return float(value)

    if isinstance(value, UUID):
        return str(value)

    if isinstance(value, bytes):
        return f"<bytes:{len(value)}>"

    if isinstance(value, Mapping):
        return _sanitize_mapping(value, depth=_depth)

    if isinstance(value, (list, tuple, set, frozenset)):
        items = list(value)
        if not capture_io_enabled() and len(items) > 5:
            return {"count": len(items), "preview": [sanitize_for_trace(v, _depth=_depth + 1) for v in items[:3]]}
        return [sanitize_for_trace(v, _depth=_depth + 1) for v in items]

    return str(value)


class TraceObservation:
    def __init__(self, obj=None, *, is_root: bool = False, context_manager=None, attribute_context_manager=None, ended: bool = False):
        self.obj = obj
        self.is_root = is_root
        self._context_manager = context_manager
        self._attribute_context_manager = attribute_context_manager
        self._ended = ended

    @property
    def enabled(self) -> bool:
        return self.obj is not None

    def span(self, **kwargs):
        return _create_child_observation(self, "span", **kwargs)

    def generation(self, **kwargs):
        return _create_child_observation(self, "generation", **kwargs)

    def tool(self, **kwargs):
        return _create_child_observation(self, "tool", **kwargs)

    def event(self, **kwargs):
        return _create_child_observation(self, "event", **kwargs)

    def update(self, **kwargs):
        if not self.obj or self._ended:
            return self
        try:
            clean = _sanitize_kwargs(kwargs)
            if self.is_root and hasattr(self.obj, "set_trace_io"):
                trace_io = {k: clean[k] for k in ("input", "output") if k in clean}
                if trace_io:
                    self.obj.set_trace_io(**trace_io)
            if hasattr(self.obj, "update"):
                self.obj.update(**clean)
        except Exception as err:
            trace_log(f"langfuse_update_error error={err}")
        return self

    def end(self, **kwargs):
        if not self.obj or self._ended:
            return self
        try:
            clean = _sanitize_kwargs(kwargs)
            if self.is_root and hasattr(self.obj, "set_trace_io"):
                trace_io = {k: clean[k] for k in ("input", "output") if k in clean}
                if trace_io:
                    self.obj.set_trace_io(**trace_io)
            if self._context_manager:
                if hasattr(self.obj, "update") and clean:
                    self.obj.update(**clean)
                self._exit_contexts(None, None, None)
            elif hasattr(self.obj, "end"):
                if hasattr(self.obj, "update") and clean:
                    try:
                        self.obj.update(**clean)
                    except Exception as err:
                        trace_log(f"langfuse_update_before_end_error error={err}")
                    self.obj.end()
                else:
                    self.obj.end(**clean)
            elif hasattr(self.obj, "update"):
                self.obj.update(**clean)
        except Exception as err:
            trace_log(f"langfuse_end_error error={err}")
        finally:
            self._ended = True
        return self

    def _exit_contexts(self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: TracebackType | None):
        for cm in (self._attribute_context_manager, self._context_manager):
            if not cm:
                continue
            try:
                cm.__exit__(exc_type, exc, tb)
            except Exception as err:
                trace_log(f"langfuse_context_exit_error error={err}")


def _sanitize_kwargs(kwargs: dict) -> dict:
    clean = {}
    for key, value in kwargs.items():
        if value is None:
            continue
        if key in {"input", "output", "metadata"}:
            clean[key] = sanitize_for_trace(value)
        else:
            clean[key] = value
    return clean


def _mask_sdk_data(*, data, **_kwargs):
    return sanitize_for_trace(data)


def _mask_otel_value(value):
    if capture_io_enabled():
        return value
    if isinstance(value, str):
        return _sanitize_text(value)
    if isinstance(value, (list, tuple)) and all(isinstance(item, str) for item in value):
        return [_sanitize_text(item) for item in value]
    return value


def _mask_otel_spans(*, params):
    if capture_io_enabled():
        return None
    try:
        from langfuse.types import MaskOtelSpansResult, OtelSpanPatch

        patches = {}
        for identifier, span in params.spans.items():
            replacements = {}
            for key, value in span.attributes.items():
                key_str = str(key)
                if SENSITIVE_KEY_RE.search(key_str):
                    replacements[key] = "[redacted]"
                    continue
                masked = _mask_otel_value(value)
                if masked != value:
                    replacements[key] = masked
            if replacements:
                patches[identifier] = OtelSpanPatch(set_attributes=replacements)
        return MaskOtelSpansResult(span_patches=patches) if patches else None
    except Exception as err:
        trace_log(f"langfuse_mask_otel_error error={err}")
        return None


def get_langfuse_client():
    global _client, _client_failed
    if _client is not None:
        return _client
    configure_langfuse_environment()
    if _client_failed or not is_langfuse_enabled():
        return None
    try:
        from langfuse import Langfuse

        kwargs = {
            "public_key": os.environ.get("LANGFUSE_PUBLIC_KEY"),
            "secret_key": os.environ.get("LANGFUSE_SECRET_KEY"),
            "tracing_enabled": True,
            "mask": _mask_sdk_data,
            "mask_otel_spans": _mask_otel_spans,
        }
        base_url = os.environ.get("LANGFUSE_BASE_URL", "https://cloud.langfuse.com")
        try:
            _client = Langfuse(**kwargs, host=base_url)
        except TypeError:
            _client = Langfuse(**kwargs, base_url=base_url)
        return _client
    except Exception as err:
        _client_failed = True
        trace_log(f"langfuse_disabled error={err}")
        return None


def start_trace(*, name: str, input=None, output=None, metadata=None, user_id=None, session_id=None, tags=None) -> TraceObservation:
    client = get_langfuse_client()
    if not client:
        return TraceObservation()
    try:
        kwargs = _sanitize_kwargs({"input": input, "output": output, "metadata": metadata})
        if user_id:
            kwargs["user_id"] = str(user_id)
        if session_id:
            kwargs["session_id"] = str(session_id)
        if hasattr(client, "trace"):
            return TraceObservation(client.trace(name=name, **kwargs), is_root=True)

        if hasattr(client, "start_observation"):
            observation_kwargs = {k: v for k, v in kwargs.items() if k not in {"user_id", "session_id"}}
            metadata_value = dict(observation_kwargs.get("metadata") or {})
            if user_id:
                metadata_value["langfuse_user_id"] = str(user_id)
            if session_id:
                metadata_value["langfuse_session_id"] = str(session_id)
            if tags:
                metadata_value["langfuse_tags"] = list(tags)
            observation_kwargs["metadata"] = metadata_value
            observation = client.start_observation(name=name, as_type="span", **observation_kwargs)
            if hasattr(observation, "set_trace_io"):
                trace_io = {k: observation_kwargs[k] for k in ("input", "output") if k in observation_kwargs}
                if trace_io:
                    observation.set_trace_io(**trace_io)
            return TraceObservation(observation, is_root=True)
    except Exception as err:
        trace_log(f"langfuse_start_trace_error name={name} error={err}")
    return TraceObservation()


def _create_child_observation(parent: TraceObservation | None, kind: str, **kwargs) -> TraceObservation:
    base = parent if isinstance(parent, TraceObservation) else get_current_trace()
    obj = base.obj if isinstance(base, TraceObservation) else None
    if not obj:
        return TraceObservation()
    try:
        clean = _sanitize_kwargs(kwargs)
        if kind == "event":
            if hasattr(obj, "start_observation"):
                try:
                    name = clean.get("name")
                    event = TraceObservation(obj.start_observation(name=name, as_type="event"))
                    event.update(**{k: v for k, v in clean.items() if k != "name"})
                    event.end()
                    return event
                except TypeError:
                    pass
            if hasattr(obj, "create_event"):
                return TraceObservation(obj.create_event(**clean), ended=True)
        if hasattr(obj, kind):
            return TraceObservation(getattr(obj, kind)(**clean))
        if hasattr(obj, "start_observation"):
            as_type = {
                "event": "event",
                "generation": "generation",
                "tool": "tool",
            }.get(kind, "span")
            return TraceObservation(obj.start_observation(as_type=as_type, **clean), ended=kind == "event")
    except Exception as err:
        trace_log(f"langfuse_start_{kind}_error name={kwargs.get('name')} error={err}")
    return TraceObservation()


def get_current_trace() -> TraceObservation:
    trace = _current_trace.get()
    return trace if isinstance(trace, TraceObservation) else TraceObservation()


def set_trace_context(trace: TraceObservation | None = None, *, request_id: str | None = None):
    return (
        _current_trace.set(trace or TraceObservation()),
        _current_request_id.set(request_id),
        _trace_fields.set({}),
    )


def reset_trace_context(tokens):
    if not tokens:
        return
    trace_token, request_token, fields_token = tokens
    _current_trace.reset(trace_token)
    _current_request_id.reset(request_token)
    _trace_fields.reset(fields_token)


def update_trace_fields(**fields):
    current = dict(_trace_fields.get() or {})
    current.update({k: v for k, v in fields.items() if v is not None})
    _trace_fields.set(current)
    get_current_trace().update(metadata=current)


def get_trace_fields() -> dict:
    return dict(_trace_fields.get() or {})


def start_span(*, name: str, input=None, metadata=None) -> TraceObservation:
    span = _create_child_observation(get_current_trace(), "span", name=name, input=input, metadata=metadata)
    _current_observation.set(span)
    return span


def start_tool(*, name: str, input=None, metadata=None) -> TraceObservation:
    return _create_child_observation(get_current_trace(), "tool", name=name, input=input, metadata=metadata)


def record_event(*, name: str, input=None, output=None, metadata=None) -> TraceObservation:
    return _create_child_observation(get_current_trace(), "event", name=name, input=input, output=output, metadata=metadata)


def start_generation(*, name: str, model=None, input=None, metadata=None, model_parameters=None) -> TraceObservation:
    generation = _create_child_observation(
        get_current_trace(),
        "generation",
        name=name,
        model=model,
        input=input,
        metadata=metadata,
        model_parameters=model_parameters,
    )
    _current_observation.set(generation)
    return generation


def get_current_observation_context() -> dict:
    observation = _current_observation.get() or _current_trace.get()
    if not isinstance(observation, TraceObservation) or not observation.obj:
        return {}
    trace_id = getattr(observation.obj, "trace_id", None)
    observation_id = getattr(observation.obj, "id", None)
    context = {}
    if trace_id:
        context["trace_id"] = trace_id
    if observation_id:
        context["parent_observation_id"] = observation_id
    return context


def get_langfuse_openai_kwargs(*, name: str, metadata: dict | None = None) -> dict:
    if not is_langfuse_enabled():
        return {}
    context = get_current_observation_context()
    return {
        "name": name,
        "metadata": sanitize_for_trace(metadata or {}),
        **context,
    }


def update_current_observation(**kwargs):
    observation = _current_observation.get() or get_current_trace()
    if isinstance(observation, TraceObservation):
        observation.update(**kwargs)


def flush_langfuse(*, force: bool = False):
    if not force and not _env_bool("LANGFUSE_FLUSH_ON_REQUEST"):
        return
    client = get_langfuse_client()
    if not client:
        return
    try:
        if hasattr(client, "flush"):
            client.flush()
    except Exception as err:
        trace_log(f"langfuse_flush_error error={err}")
