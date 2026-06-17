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

---

## Run the Server

```bash
# Option A — direct Python (starts uvicorn)
python app.py

# Option B — uvicorn
uvicorn app:asgi_app --host 0.0.0.0 --port 3000

# Option C — Gunicorn with an ASGI worker (production)
gunicorn app:asgi_app --bind 0.0.0.0:3000 --workers 2 -k uvicorn.workers.UvicornWorker
```

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

The `Dockerfile` and `docker-compose.yml` in the repository root require updating for Python.  
See `MIGRATION_NOTES.md` for details.
