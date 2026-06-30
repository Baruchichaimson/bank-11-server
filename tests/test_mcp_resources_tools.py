import json
from types import SimpleNamespace

import pytest

from ai.llm.errors import LLMRoutingError, PromptLoadError
from ai.mcp import mcp_client, mcp_risk
from ai.mcp.mcp_client import account_current_resource_uri
from ai.services.transfer_risk_gate import evaluate_transfer_execution_risk
from ai.workflows.transfer.transfer_state_machine import run_transfer_node
from config import settings
from mcp_server.account_context import build_current_account_context


SAFE_ACCOUNT_CONTEXT = {
    "userId": "sender-1",
    "userEmail": "sender@example.com",
    "accountId": "account-sender",
    "balance": 5000.0,
    "accountSummary": {"status": "ACTIVE", "currency": "ILS"},
}

SAFE_RISK_RESULT = {
    "score": 70,
    "level": "HIGH",
    "requiresReview": True,
    "reasons": ["Transfer amount above 1000"],
    "checks": {
        "amount": 1500.0,
        "recentOutgoingCount": 0,
        "hasBeneficiaryHistory": True,
        "remainingBalance": 3500.0,
    },
}

SENSITIVE_KEYS = {"password", "token", "jwt", "access_token", "secret"}


def _completion_response(content):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content if isinstance(content, str) else json.dumps(content))
            )
        ],
    )


def _risk_llm(calls=None):
    calls = calls if calls is not None else []

    async def fake_llm(payload):
        calls.append(payload["operation"])
        if payload["operation"] == "risk_analysis":
            return _completion_response({"level": "LOW", "reason": "ok"})
        if payload["operation"] == "risk_judge":
            return _completion_response({"approval": "ACCEPTED", "reason": "ok"})
        raise AssertionError(f"unexpected operation {payload['operation']}")

    return fake_llm


class FixedRiskService:
    def __init__(self, result=None):
        self.result = result or {
            "level": "LOW",
            "score": 0,
            "requiresReview": False,
            "reasons": [],
            "checks": {"remainingBalance": 4900.0},
        }
        self.payloads = []

    def evaluateRisk(self, payload):
        self.payloads.append(payload)
        return self.result


class TransferProfileService:
    sender = {"_id": "sender-1", "email": "sender@example.com"}
    receiver = {"_id": "receiver-1", "email": "receiver@example.com"}

    def getUserById(self, user_id):
        return self.sender if str(user_id) == self.sender["_id"] else None

    def getUserByEmail(self, email):
        return self.receiver if str(email).lower() == self.receiver["email"] else None


class TransferAccountService:
    def __init__(self, *, sender_balance=5000.0):
        self.accounts = {
            "sender-1": {"_id": "account-sender", "userId": "sender-1", "balance": sender_balance},
            "receiver-1": {"_id": "account-receiver", "userId": "receiver-1", "balance": 100.0},
        }

    async def get_account_by_user_id(self, user_id):
        return self.accounts.get(str(user_id))

    async def find_account_by_id(self, account_id):
        for account in self.accounts.values():
            if account["_id"] == account_id:
                return account
        return None


class TransferTransactionService:
    def __init__(self, calls):
        self.calls = calls
        self.executed = None

    async def execute_transfer(self, **kwargs):
        self.calls.append("execute_transfer")
        self.executed = kwargs
        return {"_id": "tx-1", "status": "success", **kwargs}

    async def count_monthly_outgoing_transfers(self, **_kwargs):
        return 0


def _assert_no_sensitive_keys(payload):
    serialized = json.dumps(payload).lower()
    for key in SENSITIVE_KEYS:
        assert key not in serialized


@pytest.mark.asyncio
async def test_mocked_mcp_account_resource_returns_safe_context(monkeypatch):
    async def fake_fetch(user_id):
        assert user_id == "sender-1"
        return SAFE_ACCOUNT_CONTEXT

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(mcp_risk, "fetch_current_account", fake_fetch)

    balance, source, meta = await mcp_risk.resolve_sender_account_context(
        sender_user={"_id": "sender-1", "email": "sender@example.com"},
        sender_account={"_id": "account-sender", "balance": 100.0},
    )

    assert source == "mcp"
    assert balance == 5000.0
    assert meta == {}
    _assert_no_sensitive_keys(SAFE_ACCOUNT_CONTEXT)


def test_account_current_resource_uri_uses_documented_prefix():
    assert account_current_resource_uri("sender-1") == "account://current/sender-1"


def test_build_current_account_context_excludes_sensitive_fields(monkeypatch):
    monkeypatch.setattr(
        "mcp_server.account_context.find_user_by_id",
        lambda _user_id: {
            "_id": "sender-1",
            "email": "sender@example.com",
            "password": "secret-password",
            "access_token": "secret-token",
        },
    )
    monkeypatch.setattr(
        "mcp_server.account_context.find_account_by_user_id",
        lambda _user_id: {"_id": "account-sender", "status": "ACTIVE", "balance": 5000.0},
    )

    context = build_current_account_context("sender-1")

    assert context["userEmail"] == "sender@example.com"
    assert context["balance"] == 5000.0
    _assert_no_sensitive_keys(context)


@pytest.mark.asyncio
async def test_mocked_mcp_evaluate_det_risk_returns_deterministic_shape(monkeypatch):
    async def fake_tool(payload):
        assert payload["senderEmail"] == "sender@example.com"
        return SAFE_RISK_RESULT

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(mcp_risk, "call_evaluate_det_risk", fake_tool)

    result, source, meta = await mcp_risk.evaluate_deterministic_transfer_risk(
        payload={
            "senderEmail": "sender@example.com",
            "receiverEmail": "receiver@example.com",
            "amount": 1500.0,
            "senderBalance": 5000.0,
        },
        services=None,
    )

    assert source == "mcp"
    assert meta == {}
    assert result["level"] == "HIGH"
    assert result["checks"]["remainingBalance"] == 3500.0


@pytest.mark.asyncio
async def test_mcp_unavailable_falls_back_to_local_deterministic_risk(monkeypatch):
    risk_service = FixedRiskService()

    async def fake_tool(_payload):
        raise mcp_client.MCPFetchError("timeout")

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(settings, "MCP_FALLBACK_TO_LOCAL", True)
    monkeypatch.setattr(mcp_risk, "call_evaluate_det_risk", fake_tool)

    result, source, meta = await mcp_risk.evaluate_deterministic_transfer_risk(
        payload={
            "senderEmail": "sender@example.com",
            "receiverEmail": "receiver@example.com",
            "amount": 100.0,
            "senderBalance": 5000.0,
        },
        services={"riskService": risk_service},
    )

    assert source == "local"
    assert meta["mcp_fallback"] is True
    assert "timeout" in meta["mcp_error"]
    assert len(risk_service.payloads) == 1


@pytest.mark.asyncio
async def test_mcp_unavailable_without_fallback_raises_for_deterministic_risk(monkeypatch):
    async def fake_tool(_payload):
        raise mcp_client.MCPFetchError("down")

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(settings, "MCP_FALLBACK_TO_LOCAL", False)
    monkeypatch.setattr(mcp_risk, "call_evaluate_det_risk", fake_tool)

    with pytest.raises(LLMRoutingError, match="fallback is disabled"):
        await mcp_risk.evaluate_deterministic_transfer_risk(
            payload={
                "senderEmail": "sender@example.com",
                "receiverEmail": "receiver@example.com",
                "amount": 100.0,
                "senderBalance": 5000.0,
            },
            services={"riskService": FixedRiskService()},
        )


@pytest.mark.asyncio
async def test_mcp_account_unavailable_without_fallback_raises(monkeypatch):
    async def fake_fetch(_user_id):
        raise mcp_client.MCPFetchError("down")

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(settings, "MCP_FALLBACK_TO_LOCAL", False)
    monkeypatch.setattr(mcp_risk, "fetch_current_account", fake_fetch)

    with pytest.raises(PromptLoadError, match="fallback is disabled"):
        await mcp_risk.resolve_sender_account_context(
            sender_user={"_id": "sender-1", "email": "sender@example.com"},
            sender_account={"_id": "account-sender", "balance": 5000.0},
        )


@pytest.mark.asyncio
async def test_transfer_still_executes_when_balance_is_sufficient_with_mcp_enabled(monkeypatch):
    calls = []
    services = {
        "profileService": TransferProfileService(),
        "accountService": TransferAccountService(sender_balance=5000.0),
        "transactionService": TransferTransactionService(calls),
        "riskService": FixedRiskService(
            {"level": "HIGH", "score": 70, "requiresReview": True, "reasons": [], "checks": {"remainingBalance": 4900.0}}
        ),
    }

    async def fake_account(_user_id):
        return SAFE_ACCOUNT_CONTEXT

    async def fake_tool(_payload):
        return {
            "level": "HIGH",
            "score": 70,
            "requiresReview": True,
            "reasons": [],
            "checks": {"remainingBalance": 4900.0},
        }

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(mcp_risk, "fetch_current_account", fake_account)
    monkeypatch.setattr(mcp_risk, "call_evaluate_det_risk", fake_tool)

    result = await run_transfer_node(
        {
            "userInput": "submitted transfer form",
            "session": {"userId": "sender-1", "userEmail": "sender@example.com", "userLanguage": "en"},
            "intent": {"intent": "transfer_money", "transferPayload": {}},
            "transfer": {
                "receiverEmail": "receiver@example.com",
                "amount": 100,
                "description": "rent",
                "flowLanguage": "en",
            },
        },
        {"configurable": {"services": services, "createChatCompletion": _risk_llm(calls=calls)}},
    )

    assert calls == ["risk_analysis", "risk_judge", "execute_transfer"]
    assert result["riskDecision"]["allowed"] is True
    assert services["transactionService"].executed is not None


@pytest.mark.asyncio
async def test_transfer_blocks_when_remaining_balance_negative(monkeypatch):
    calls = []

    async def fake_account(_user_id):
        return {**SAFE_ACCOUNT_CONTEXT, "balance": 5000.0}

    async def fake_tool(_payload):
        return {
            "level": "HIGH",
            "score": 100,
            "requiresReview": True,
            "reasons": ["Insufficient funds after transfer"],
            "checks": {"remainingBalance": -1000.0},
        }

    monkeypatch.setattr(settings, "MCP_ENABLED", True)
    monkeypatch.setattr(mcp_risk, "fetch_current_account", fake_account)
    monkeypatch.setattr(mcp_risk, "call_evaluate_det_risk", fake_tool)

    result = await evaluate_transfer_execution_risk(
        sender_user={"_id": "sender-1", "email": "sender@example.com"},
        receiver_user={"_id": "receiver-1", "email": "receiver@example.com"},
        sender_account={"_id": "account-sender", "balance": 5000.0},
        receiver_account={"_id": "account-receiver", "balance": 100.0},
        amount=6000.0,
        description="rent",
        services={"riskService": FixedRiskService()},
        create_chat_completion=_risk_llm(calls=calls),
    )

    assert result["riskDecision"]["allowed"] is False
    assert result["riskDecision"]["status"] == "blocked"
    assert calls == ["risk_analysis", "risk_judge"]
