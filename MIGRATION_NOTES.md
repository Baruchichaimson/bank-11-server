# Migration Notes — Node.js / Express → Python / Flask

## Overview

This document describes the migration of the **Bank One One** backend from  
Node.js (Express) to Python (Flask).

Branch: `migrate-backend-to-python-flask`

---

## What Was Migrated

### Core Infrastructure

| Node.js file | Python equivalent | Notes |
|---|---|---|
| `server.js` | `app.py` | Flask app factory + socketio startup |
| `config/db.js` | `config/db.py` | PyMongo, same URI env var |
| `config/corsOrigins.js` | `config/cors_origins.py` | Same logic |
| `config/settings.js` (inline) | `config/settings.py` | All env vars centralised |

### Middleware

| Node.js file | Python equivalent |
|---|---|
| `middleware/auth.js` | `middleware/auth.py` |
| Express rate-limit | `middleware/rate_limit.py` (Flask-Limiter) |
| Helmet | `middleware/security_headers.py` |

### Models

| Node.js (Mongoose) | Python (PyMongo) | Collection |
|---|---|---|
| `models/usersModel.js` | `models/user_model.py` | `users` |
| `models/accountsModel.js` | `models/account_model.py` | `accounts` |
| `models/transactionsModel.js` | `models/transaction_model.py` | `transactions` |

Field names and indexes are preserved for full MongoDB data compatibility.

### Controllers & Routes

| Node.js | Python |
|---|---|
| `controllers/authsController.js` | `controllers/auth_controller.py` |
| `controllers/accountsController.js` | `controllers/accounts_controller.py` |
| `controllers/transactionsController.js` | `controllers/transactions_controller.py` |
| `routes/authsRoutes.js` | `routes/auth_routes.py` |
| `routes/accountsRoutes.js` | `routes/accounts_routes.py` |
| `routes/transactionsRoutes.js` | `routes/transactions_routes.py` |

### Services & Utilities

| Node.js | Python |
|---|---|
| `utils/emailService.js` / Brevo provider | `utils/email_service.py` |
| `utils/validators.js` | `utils/validators.py` |
| `utils/pendingRegistrationCleanup.js` | `utils/pending_registration_cleanup.py` (APScheduler) |
| `ai/riskAssessment.js` | `services/risk_service.py` |

### AI / LangGraph

| Node.js | Python |
|---|---|
| `ai/assistant/chatAssistant.js` | `ai/assistant/chat_assistant.py` |
| `ai/assistant/openaiClient.js` | `ai/assistant/openai_client.py` |
| `ai/assistant/shared.js` | `ai/assistant/shared.py` |
| `ai/assistant/responseFormatting.js` | `ai/assistant/response_formatting.py` |
| `ai/assistant/responseWrappers.js` | `ai/assistant/response_wrappers.py` |
| `ai/graph/bankingGraph.js` | `ai/graph/banking_graph.py` |
| `ai/graph/bankingState.js` | `ai/graph/banking_state.py` |
| `ai/graph/workflowRouter.js` | `ai/graph/workflow_router.py` |
| `ai/workflows/balanceWorkflow.js` | `ai/workflows/balance_workflow.py` |
| `ai/workflows/transactionsWorkflow.js` | `ai/workflows/transactions_workflow.py` |
| `ai/workflows/supportWorkflow.js` | `ai/workflows/support_workflow.py` |
| `ai/workflows/personalDetailsWorkflow.js` | `ai/workflows/personal_details_workflow.py` |
| `ai/workflows/unknownWorkflow.js` | `ai/workflows/unknown_workflow.py` |
| `ai/workflows/transfer/transferStateMachine.js` (+ helpers) | `ai/workflows/transfer/transfer_state_machine.py` |
| `ai/workflows/transferWorkflow.js` | `ai/workflows/transfer_workflow.py` |
| `ai/contracts/assistantResponseContract.js` | `ai/contracts/assistant_response_contract.py` |
| `ai/contracts/intentResultContract.js` | `ai/contracts/intent_result_contract.py` |
| `ai/intents/detectIntent.js` | `ai/intents/detect_intent.py` |
| `ai/intents/llmPromptPayloadBuilder.js` | `ai/intents/llm_prompt_payload_builder.py` |
| `ai/intents/llmSemanticParser.js` | `ai/intents/llm_semantic_parser.py` |
| `ai/intents/semanticCatalog.js` | `ai/intents/semantic_catalog.py` |
| `ai/repositories/*` | `ai/repositories/*` |
| `ai/services/*` | `ai/services/*` |

### Socket.IO

| Node.js | Python |
|---|---|
| `socket/socketServer.js` | `realtime/socket_server.py` (python-socketio ASGI) |

---

## Files Removed / Replaced

The following Node.js files are superseded by their Python equivalents above  
and can be deleted after the migration is verified:

- `server.js`
- `package.json` / `package-lock.json`
- All `*.js` files under `controllers/`, `routes/`, `middleware/`, `models/`, `utils/`, `ai/`, `socket/`
- `node_modules/` (already gitignored)

`package.json` has been left in place during the transition period so it  
remains visible for reference. It can be deleted once the Python backend is  
confirmed working in production.

---

## Known Differences & Manual Review Notes

### 1. Socket.IO Cancellation

**JS:** Node.js `AbortController` / `AbortSignal` allows true mid-stream  
cancellation of an in-flight LLM call.

**Python:** `python-socketio.AsyncServer` runs on the ASGI event loop. Chatbot  
work is stored as an `asyncio.Task` per `requestId`, and `cancel_chat_message`  
calls `task.cancel()` so in-flight async LLM calls can be canceled.

**Action required:** Deploy with an ASGI server such as uvicorn, or gunicorn  
with `uvicorn.workers.UvicornWorker`.

### 2. MongoDB Transactions (Atomicity)

**JS (Mongoose):** Uses Mongoose sessions for atomic balance updates.

**Python:** `models/transaction_model.py` uses PyMongo sessions when a  
replica set is available. It falls back to a non-atomic sequence if the  
MongoDB instance is a standalone (which is the dev default).

**Action required:** Use a MongoDB replica set in production (even a  
single-node replica set is sufficient) to get ACID guarantees.

### 3. Docker Files

`Dockerfile` and `docker-compose.yml` still reference Node.js.  
**Action required:** Update them for Python:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["gunicorn", "app:asgi_app", "--bind", "0.0.0.0:3000", "--workers", "2", "-k", "uvicorn.workers.UvicornWorker"]
```

### 4. Password Reset HTML Pages

The HTML for `/reset-password` is rendered via Python's f-strings matching  
the original inline HTML in `authsController.js`.  
Visual QA against the original pages is recommended.

### 5. Rate Limiting Storage

`Flask-Limiter` defaults to in-memory storage.  
For multi-worker / multi-process deployments, configure Redis as the backend:

```python
limiter = Limiter(storage_uri="redis://localhost:6379")
```

### 6. APScheduler vs setInterval

The pending-registration cleanup job uses APScheduler (`BackgroundScheduler`)  
instead of `setInterval`.  
Behaviour is identical for single-process deployments.  
Multi-process deployments need a distributed lock or a dedicated scheduler.

---

## Frontend Compatibility

- All HTTP API routes are identical.
- JWT cookie (`access_token`) name, `httpOnly`, `secure`, `samesite` flags preserved.
- Response body shapes and HTTP status codes match exactly.
- Socket.IO event names are unchanged.
- No frontend code changes should be required.

---

## How to Verify

```bash
# Install dependencies
pip install -r requirements.txt

# Start the server (requires a running MongoDB and .env file)
python app.py

# Run tests (no DB required)
pytest tests/ -v
```
