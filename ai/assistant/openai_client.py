"""
OpenAI/Ollama/Groq client — port of openaiClient.js.
"""

from openai import OpenAI
from config.settings import (
    AI_PROVIDER,
    OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL, OPENAI_FALLBACK_MODEL,
    OLLAMA_API_KEY, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_FALLBACK_MODEL,
    GROQ_API_KEY, GROQ_BASE_URL, GROQ_MODEL, GROQ_FALLBACK_MODEL,
)

_providers = {
    "ollama": {
        "api_key": OLLAMA_API_KEY or OPENAI_API_KEY or "ollama",
        "base_url": OLLAMA_BASE_URL or "http://localhost:11434/v1",
        "model": OLLAMA_MODEL or OPENAI_MODEL or "llama3.1",
        "fallback_model": OLLAMA_FALLBACK_MODEL or OPENAI_FALLBACK_MODEL,
    },
    "groq": {
        "api_key": GROQ_API_KEY or "",
        "base_url": GROQ_BASE_URL or "https://api.groq.com/openai/v1",
        "model": GROQ_MODEL or "llama-3.1-8b-instant",
        "fallback_model": GROQ_FALLBACK_MODEL or OPENAI_FALLBACK_MODEL,
    },
    "openai": {
        "api_key": OPENAI_API_KEY or "",
        "base_url": OPENAI_BASE_URL or "",
        "model": OPENAI_MODEL or "gpt-4o-mini",
        "fallback_model": OPENAI_FALLBACK_MODEL,
    },
}

_config = _providers.get(AI_PROVIDER, _providers["openai"])

if AI_PROVIDER == "ollama":
    has_openai_key = bool(_config["base_url"])
else:
    has_openai_key = bool(_config["api_key"])

OPENAI_MODEL = _config["model"]
OPENAI_FALLBACK_MODEL = _config["fallback_model"] or OPENAI_MODEL

_client_kwargs: dict = {"api_key": _config["api_key"]}
if _config["base_url"]:
    _client_kwargs["base_url"] = _config["base_url"]

openai_client: OpenAI | None = OpenAI(**_client_kwargs) if has_openai_key else None
