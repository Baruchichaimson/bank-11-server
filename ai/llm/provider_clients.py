from ai.llm.errors import ProviderNotConfiguredError
from config.settings import (
    GROQ_API_KEY,
    GROQ_BASE_URL,
    OLLAMA_API_KEY,
    OLLAMA_BASE_URL,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
)
from observability.langfuse_tracing import get_langfuse_openai_kwargs


_INTERNAL_PROVIDER_PAYLOAD_KEYS = {
    "operation",
    "provider",
    "prompt_file",
    "cost_tier",
    "metadata",
    "abortSignal",
    "langfuse_name",
}


def _provider_credentials(provider: str) -> dict:
    provider = str(provider or "").lower()

    if provider == "openai":
        return {"api_key": OPENAI_API_KEY, "base_url": OPENAI_BASE_URL}

    if provider == "groq":
        return {
            "api_key": GROQ_API_KEY,
            "base_url": GROQ_BASE_URL or "https://api.groq.com/openai/v1",
        }

    if provider == "ollama":
        return {
            "api_key": OLLAMA_API_KEY or "ollama",
            "base_url": OLLAMA_BASE_URL or "http://localhost:11434/v1",
        }

    if provider == "gemini":
        raise ProviderNotConfiguredError("Provider 'gemini' is not configured in this runtime")

    raise ProviderNotConfiguredError(f"Unsupported LLM provider: {provider}")


async def invoke_provider_chat_completion(payload: dict):
    provider = str(payload.get("provider") or "").lower()
    credentials = _provider_credentials(provider)
    api_key = credentials.get("api_key")
    base_url = credentials.get("base_url")

    if provider != "ollama" and not api_key:
        raise ProviderNotConfiguredError(f"Missing API key for provider: {provider}")

    try:
        from langfuse.openai import AsyncOpenAI
        is_langfuse_client = True
    except Exception:  # pragma: no cover
        from openai import AsyncOpenAI
        is_langfuse_client = False

    client_kwargs = {"api_key": api_key}
    if base_url:
        client_kwargs["base_url"] = base_url

    kwargs = {
        key: value
        for key, value in payload.items()
        if key not in _INTERNAL_PROVIDER_PAYLOAD_KEYS
        and value is not None
    }

    if is_langfuse_client:
        kwargs.update(
            get_langfuse_openai_kwargs(
                name=payload.get("langfuse_name") or f"llm.{payload.get('operation') or 'chat'}",
                metadata=payload.get("metadata") or {},
            )
        )

    client = AsyncOpenAI(**client_kwargs)
    return await client.chat.completions.create(**kwargs)
