import os
from dotenv import load_dotenv

load_dotenv()


def _get_env_int(name: str, default: int) -> int:
    raw_value = os.environ.get(name, "").strip()
    if not raw_value:
        return default
    return int(raw_value)

PORT = int(os.environ.get("PORT", 3000))
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://127.0.0.1:27017/bank-11")
JWT_SECRET = os.environ.get("JWT_SECRET", "")
NODE_ENV = os.environ.get("NODE_ENV", "development")
IS_PRODUCTION = NODE_ENV == "production"

MAIL_FROM = os.environ.get("MAIL_FROM", "")
MAIL_FROM_NAME = os.environ.get("MAIL_FROM_NAME", "Bank One One")
BREVO_API_KEY = os.environ.get("BREVO_API_KEY", "")
APP_BASE_URL = os.environ.get("APP_BASE_URL", "")
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "")
OPENAI_FALLBACK_MODEL = os.environ.get("OPENAI_FALLBACK_MODEL", "")

OLLAMA_API_KEY = os.environ.get("OLLAMA_API_KEY", "")
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434/v1")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.1")
OLLAMA_FALLBACK_MODEL = os.environ.get("OLLAMA_FALLBACK_MODEL", "")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")
GROQ_FALLBACK_MODEL = os.environ.get("GROQ_FALLBACK_MODEL", "")

AI_PROVIDER = os.environ.get("AI_PROVIDER", "openai").lower()
if AI_PROVIDER == "ollama":
    ACTIVE_AI_MODEL = OLLAMA_MODEL or OPENAI_MODEL or "llama3.1"
elif AI_PROVIDER == "groq":
    ACTIVE_AI_MODEL = GROQ_MODEL or "llama-3.1-8b-instant"
else:
    ACTIVE_AI_MODEL = OPENAI_MODEL or "gpt-4o-mini"

CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "")
SOCKET_CORS_ORIGINS = os.environ.get("SOCKET_CORS_ORIGINS", "")

ASSISTANT_DEBUG_ERRORS = os.environ.get("ASSISTANT_DEBUG_ERRORS", "false").lower() == "true"
SOCKET_DEBUG = os.environ.get("SOCKET_DEBUG", "false").lower() == "true"
BANKING_GRAPH_DEBUG = os.environ.get("BANKING_GRAPH_DEBUG", "false").lower() == "true"
LANGFUSE_ENABLED = os.environ.get("LANGFUSE_ENABLED", "false").lower() == "true"
LANGFUSE_PUBLIC_KEY = os.environ.get("LANGFUSE_PUBLIC_KEY", "")
LANGFUSE_SECRET_KEY = os.environ.get("LANGFUSE_SECRET_KEY", "")
LANGFUSE_BASE_URL = os.environ.get("LANGFUSE_BASE_URL", "https://cloud.langfuse.com")
LANGFUSE_CAPTURE_IO = os.environ.get("LANGFUSE_CAPTURE_IO", "false").lower() == "true"
ASSISTANT_TRACE_LOGS = os.environ.get("ASSISTANT_TRACE_LOGS", "false").lower() == "true"

MCP_ENABLED = os.environ.get("MCP_ENABLED", "false").lower() == "true"
MCP_SERVER_URL = os.environ.get("MCP_SERVER_URL", "http://localhost:8000/mcp")
MCP_TIMEOUT_MS = _get_env_int("MCP_TIMEOUT_MS", 3000)
MCP_FALLBACK_TO_LOCAL = os.environ.get("MCP_FALLBACK_TO_LOCAL", "true").lower() == "true"

GCS_BUCKET_NAME = os.environ.get("GCS_BUCKET_NAME", "")
GCS_SIGNED_URL_MINUTES = _get_env_int("GCS_SIGNED_URL_MINUTES", 5)
GCS_SIGNING_SERVICE_ACCOUNT_EMAIL = os.environ.get("GCS_SIGNING_SERVICE_ACCOUNT_EMAIL", "")

PENDING_REGISTRATION_CLEANUP_INTERVAL_MS = int(
    os.environ.get("PENDING_REGISTRATION_CLEANUP_INTERVAL_MS", str(60 * 60 * 1000))
)

if not JWT_SECRET:
    raise RuntimeError("Missing required environment variable: JWT_SECRET")
