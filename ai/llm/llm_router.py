import json
import time

from ai.llm.errors import LLMResponseError, UnknownOperationError
from ai.llm.prompt_loader import PROJECT_ROOT, load_prompt
from ai.llm.provider_clients import invoke_provider_chat_completion
from ai.shared.json_safe import make_json_safe
from observability.langfuse_tracing import record_event, start_span


CONFIG_PATH = PROJECT_ROOT / "config" / "llm_routing.json"


def load_llm_routing_config() -> dict:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def resolve_operation_config(operation: str) -> dict:
    op = str(operation or "").strip()
    config = load_llm_routing_config()
    operations = config.get("operations") or {}
    if op not in operations:
        raise UnknownOperationError(f"Unknown LLM operation: {op}")

    settings = dict(operations[op] or {})
    settings["operation"] = op
    for key in ("provider", "model", "prompt_file"):
        if not settings.get(key):
            raise UnknownOperationError(f"LLM operation '{op}' is missing required setting: {key}")
    return settings


def _extract_content(response) -> str:
    try:
        return response.choices[0].message.content or ""
    except Exception:
        pass
    if isinstance(response, dict):
        choices = response.get("choices") or []
        if choices:
            message = (choices[0] or {}).get("message") or {}
            return message.get("content") or ""
    return ""


def _attach_response_metadata(parsed: dict, response, settings: dict) -> dict:
    result = dict(parsed)
    result.setdefault("model", getattr(response, "model", None) or settings.get("model"))
    result.setdefault("provider", getattr(response, "provider", None) or settings.get("provider"))
    return result


def _build_payload(*, settings: dict, prompt: str, variables: dict, text: bool = False, abort_signal=None) -> dict:
    response_format = None if text else settings.get("response_format")
    payload = {
        "operation": settings["operation"],
        "provider": settings.get("provider"),
        "model": settings.get("model"),
        "temperature": settings.get("temperature"),
        "top_p": settings.get("top_p"),
        "max_tokens": settings.get("max_tokens"),
        "response_format": response_format,
        "prompt_file": settings.get("prompt_file"),
        "cost_tier": settings.get("cost_tier"),
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": json.dumps(make_json_safe(variables or {}), ensure_ascii=False)},
        ],
        "abortSignal": abort_signal,
        "langfuse_name": f"llm.{settings['operation']}",
        "metadata": {
            "operation": settings["operation"],
            "provider": settings.get("provider"),
            "model": settings.get("model"),
            "prompt_file": settings.get("prompt_file"),
            "temperature": settings.get("temperature"),
            "max_tokens": settings.get("max_tokens"),
            "cost_tier": settings.get("cost_tier"),
        },
    }
    return {key: value for key, value in payload.items() if value is not None}


async def _invoke(operation: str, variables: dict, *, create_chat_completion=None, abort_signal=None, text: bool = False):
    start = time.perf_counter()
    settings = resolve_operation_config(operation)
    prompt = load_prompt(settings.get("prompt_file"))
    payload = _build_payload(settings=settings, prompt=prompt, variables=variables, text=text, abort_signal=abort_signal)
    span = start_span(
        name="llm_router",
        input={
            "operation": settings["operation"],
            "provider": settings.get("provider"),
            "model": settings.get("model"),
            "prompt_file": settings.get("prompt_file"),
        },
        metadata=payload.get("metadata"),
    )
    success = False
    try:
        caller = create_chat_completion or invoke_provider_chat_completion
        response = await caller(payload)
        content = _extract_content(response)
        if text:
            success = True
            return content

        try:
            parsed = json.loads(str(content or "").strip())
        except Exception as err:
            raise LLMResponseError(f"LLM operation '{operation}' returned malformed JSON: {err}") from err
        if not isinstance(parsed, dict):
            raise LLMResponseError(f"LLM operation '{operation}' returned non-object JSON")
        success = True
        return _attach_response_metadata(parsed, response, settings)
    finally:
        duration_ms = (time.perf_counter() - start) * 1000
        metadata = {
            **(payload.get("metadata") or {}),
            "success": success,
            "duration_ms": duration_ms,
        }
        span.end(output={"operation": settings["operation"], "success": success, "duration_ms": duration_ms}, metadata=metadata)
        record_event(name="llm_operation_completed", metadata=metadata)


async def invoke_llm_json(operation: str, variables: dict, *, create_chat_completion=None, abort_signal=None) -> dict:
    return await _invoke(
        operation,
        variables,
        create_chat_completion=create_chat_completion,
        abort_signal=abort_signal,
        text=False,
    )


async def invoke_llm_text(operation: str, variables: dict, *, persona=None, create_chat_completion=None, abort_signal=None) -> str:
    merged = {**(variables or {})}
    if persona is not None:
        merged["persona"] = persona
    return await _invoke(
        operation,
        merged,
        create_chat_completion=create_chat_completion,
        abort_signal=abort_signal,
        text=True,
    )
