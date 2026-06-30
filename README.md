# Bank One One — Backend (Python / Flask)

This is the Python / Flask backend for **Bank One One**.  
It was migrated from the original Node.js / Express implementation.

---

## Requirements

| Tool | Version |
|---|---|
| Python | ≥ 3.11 |
| MongoDB | ≥ 5.0 |

---

## Installation

```bash
# 1. Clone the repository and switch to the migration branch (or main after merge)
git clone https://github.com/Baruchichaimson/bank-11-server.git
cd bank-11-server

# 2. Create a virtual environment
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Copy the example env file and fill in your values
cp .env.example .env
```

---

## Environment Variables

See `.env.example` for the full list with descriptions.

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | **yes** | — | Secret used to sign JWT tokens |
| `MONGO_URI` | **yes** | `mongodb://127.0.0.1:27017/bank-11` | MongoDB connection string |
| `PORT` | no | `3000` | HTTP port |
| `CORS_ORIGINS` | no | (local dev list) | Allowed frontend origins, comma-separated |
| `BREVO_API_KEY` | no | — | Brevo email API key |
| `OPENAI_API_KEY` | no | — | OpenAI key (AI assistant feature) |
| `AI_PROVIDER` | no | `openai` | `openai` / `ollama` / `groq` |
| `GCS_BUCKET_NAME` | **yes** | — | Private bucket that stores avatar objects |
| `GCS_SIGNED_URL_MINUTES` | no | `5` | Signed avatar URL lifetime in minutes |
| `GCS_SIGNING_SERVICE_ACCOUNT_EMAIL` | no | — | Service account email used for URL signing |

---

## Langfuse Tracing

Chatbot tracing is disabled by default. To enable it, set:

```bash
LANGFUSE_ENABLED=true
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

By default traces include sanitized previews and metadata only. Set
`LANGFUSE_CAPTURE_IO=true` in local development to capture fuller prompt and
model I/O. Passwords, JWTs, access tokens, reset tokens, and secret keys are
always redacted. `ASSISTANT_TRACE_LOGS=true` enables stderr timing logs without
requiring Langfuse credentials.

---

## Run the Server

The Flask/LangGraph backend and the MCP server are separate processes.

| Service | Default port | Command |
|---|---|---|
| Flask / LangGraph API | `5002` (set `PORT`) | `python app.py` |
| MCP server (Stage 7A skeleton) | `8000` | `python -m mcp_server.server` |

### Flask / LangGraph API

```bash
# Option A — direct Python (starts uvicorn)
PORT=5002 python app.py

# Option B — uvicorn
uvicorn app:asgi_app --host 0.0.0.0 --port 5002

# Option C — Gunicorn with an ASGI worker (production)
gunicorn app:asgi_app --bind 0.0.0.0:5002 --workers 2 -k uvicorn.workers.UvicornWorker
```

### MCP server (independent process)

```bash
python -m mcp_server.server
```

Optional env vars: `MCP_HOST` (default `0.0.0.0`), `MCP_PORT` (default `8000`).

Verify startup:

```bash
curl http://localhost:8000/health
```

Expected response: `{"status":"ok","service":"bank-mcp"}`. MCP endpoint: `http://localhost:8000/mcp`.

---

## Run Tests

```bash
pytest tests/ -v
```

---

## API Reference

All routes are identical to the original Node.js backend.

### Health

| Method | Path | Auth |
|---|---|---|
| GET | `/api/v1/health` | — |
| GET | `/api/v1/health/ai` | — |

### Auth

| Method | Path | Auth |
|---|---|---|
| POST | `/api/v1/auth/signup` | — |
| POST | `/api/v1/auth/login` | — |
| GET | `/api/v1/auth/verify` | — |
| POST | `/api/v1/auth/logout` | JWT |
| POST | `/api/v1/auth/forgot-password` | — |
| GET | `/api/v1/auth/reset-password/<token>` | — |
| POST | `/api/v1/auth/reset-password` | — |

### Accounts

| Method | Path | Auth |
|---|---|---|
| GET | `/api/v1/accounts/me` | JWT + verified |

### Users

| Method | Path | Auth |
|---|---|---|
| GET | `/api/v1/users/me/avatar` | JWT + verified |

### Transactions

| Method | Path | Auth |
|---|---|---|
| POST | `/api/v1/transactions` | JWT + verified |
| GET | `/api/v1/transactions` | JWT + verified |
| GET | `/api/v1/transactions/by-recipient-name/<name>` | JWT + verified |
| GET | `/api/v1/transactions/<transactionId>` | JWT + verified |

---

## Frontend Compatibility

The frontend should work without changes:
- All API routes are unchanged.
- JWT cookie name (`access_token`), flags, and expiry are preserved.
- Response shapes and HTTP status codes are identical.
- Socket.IO event names are preserved.

---

## Docker

Build and run the Flask/ASGI backend with MongoDB:

```bash
docker compose up --build
```

The API will be available at:

```bash
http://localhost:3000/api/v1/health
```

If port `3000` is already in use, run with another host port:

```bash
HOST_PORT=3001 docker compose up --build
```

For local Docker runs, `docker-compose.yml` supplies a development
`JWT_SECRET` and points `MONGO_URI` at the bundled MongoDB service. For
production, set a real `JWT_SECRET`, update CORS/frontend URLs, and provide
the required email/AI keys through environment variables.

The MongoDB container is only exposed inside the Docker network by default, so
it will not conflict with a local MongoDB already listening on port `27017`.
