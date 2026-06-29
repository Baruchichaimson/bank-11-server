import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from ai.graph.banking_graph import run_banking_graph
from ai.services.transfer_risk_gate import evaluate_transfer_execution_risk
from ai.workflows.transfer.transfer_state_machine import run_transfer_node


def _completion_response(content):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content if isinstance(content, str) else json.dumps(content))
            )
        ]
    )


class FixedRiskService:
    def __init__(self, result=None):
        self.result = result or {"level": "LOW", "score": 10, "requiresReview": False, "reasons": []}
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
    def __init__(self):
        self.accounts = {
            "sender-1": {"_id": "account-sender", "userId": "sender-1", "balance": 5000.0},
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


def _users_and_accounts():
    return {
        "sender_user": {"_id": "sender-1", "email": "sender@example.com"},
        "receiver_user": {"_id": "receiver-1", "email": "receiver@example.com"},
        "sender_account": {"_id": "account-sender", "balance": 5000.0},
        "receiver_account": {"_id": "account-receiver", "balance": 100.0},
    }


def _services(*, risk=None, calls=None):
    calls = calls if calls is not None else []
    return {
        "profileService": TransferProfileService(),
        "accountService": TransferAccountService(),
        "transactionService": TransferTransactionService(calls),
        "riskService": FixedRiskService(risk),
    }


def _state(amount=100):
    return {
        "userInput": "submitted transfer form",
        "session": {"userId": "sender-1", "userEmail": "sender@example.com", "userLanguage": "en"},
        "intent": {"intent": "transfer_money", "transferPayload": {}},
        "transfer": {
            "receiverEmail": "receiver@example.com",
            "amount": amount,
            "description": "rent",
            "flowLanguage": "en",
        },
    }


def _risk_llm(*, analysis_level="LOW", judge_approval="ACCEPTED", malformed_analysis=False, malformed_judge=False, calls=None):
    calls = calls if calls is not None else []

    async def fake_llm(payload):
        calls.append(payload["operation"])
        user_payload = json.loads(payload["messages"][-1]["content"])
        if payload["operation"] == "risk_analysis":
            assert user_payload["operation"] == "risk_analysis"
            assert user_payload["senderEmail"] == "sender@example.com"
            assert user_payload["receiverEmail"] == "receiver@example.com"
            assert user_payload["amount"] == 100.0
            assert "password" not in user_payload
            return _completion_response("not-json" if malformed_analysis else {"level": analysis_level, "reason": "analysis"})
        if payload["operation"] == "risk_judge":
            assert user_payload["operation"] == "risk_judge"
            assert user_payload["riskInput"]["amount"] == 100.0
            return _completion_response("not-json" if malformed_judge else {"approval": judge_approval, "reason": "judge"})
        raise AssertionError(f"unexpected operation {payload['operation']}")

    return fake_llm


async def _evaluate(*, analysis_level="LOW", judge_approval="ACCEPTED", deterministic=None, malformed_analysis=False, malformed_judge=False):
    calls = []
    risk = deterministic or {"level": "LOW", "score": 10, "requiresReview": False, "reasons": []}
    result = await evaluate_transfer_execution_risk(
        **_users_and_accounts(),
        amount=100.0,
        description="rent",
        services={"riskService": FixedRiskService(risk)},
        create_chat_completion=_risk_llm(
            analysis_level=analysis_level,
            judge_approval=judge_approval,
            malformed_analysis=malformed_analysis,
            malformed_judge=malformed_judge,
            calls=calls,
        ),
    )
    return result, calls


@pytest.mark.asyncio
@pytest.mark.parametrize("level", ["LOW", "MEDIUM"])
async def test_low_or_medium_risk_with_accepted_judge_allows_execution(level):
    result, calls = await _evaluate(analysis_level=level)

    assert calls == ["risk_analysis", "risk_judge"]
    assert result["riskDecision"] == {
        "allowed": True,
        "status": "evaluated",
        "reason": "Risk checks passed.",
    }


@pytest.mark.asyncio
async def test_high_risk_analysis_blocks_execution():
    result, _calls = await _evaluate(analysis_level="HIGH")

    assert result["riskAnalysis"]["level"] == "HIGH"
    assert result["riskDecision"]["allowed"] is False


@pytest.mark.asyncio
async def test_denied_judge_blocks_execution():
    result, _calls = await _evaluate(judge_approval="DENIED")

    assert result["riskJudge"]["approval"] == "DENIED"
    assert result["riskDecision"]["allowed"] is False


@pytest.mark.asyncio
async def test_deterministic_requires_review_blocks_execution_after_llm_checks():
    result, calls = await _evaluate(
        deterministic={"level": "HIGH", "score": 80, "requiresReview": True, "reasons": ["Very high transfer amount"]}
    )

    assert calls == ["risk_analysis", "risk_judge"]
    assert result["deterministicRisk"]["requiresReview"] is True
    assert result["riskDecision"]["allowed"] is False


@pytest.mark.asyncio
async def test_malformed_risk_analysis_normalizes_to_high_and_blocks():
    result, _calls = await _evaluate(malformed_analysis=True)

    assert result["riskAnalysis"]["level"] == "HIGH"
    assert result["riskDecision"]["allowed"] is False


@pytest.mark.asyncio
async def test_malformed_risk_judge_normalizes_to_denied_and_blocks():
    result, _calls = await _evaluate(malformed_judge=True)

    assert result["riskJudge"]["approval"] == "DENIED"
    assert result["riskDecision"]["allowed"] is False


@pytest.mark.asyncio
async def test_transfer_node_runs_gate_before_execute_when_allowed():
    calls = []
    services = _services(calls=calls)

    result = await run_transfer_node(
        _state(),
        {"configurable": {"services": services, "createChatCompletion": _risk_llm(calls=calls)}},
    )

    assert calls == ["risk_analysis", "risk_judge", "execute_transfer"]
    assert result["workflowResponse"]["execution"]["executed"] is True
    assert result["riskDecision"]["allowed"] is True
    assert services["transactionService"].executed["amount"] == 100.0


@pytest.mark.asyncio
async def test_transfer_node_blocks_without_execute_when_gate_denies():
    calls = []
    services = _services(calls=calls)

    result = await run_transfer_node(
        _state(),
        {
            "configurable": {
                "services": services,
                "createChatCompletion": _risk_llm(analysis_level="HIGH", calls=calls),
            }
        },
    )

    assert calls == ["risk_analysis", "risk_judge"]
    assert services["transactionService"].executed is None
    assert result["workflowResponse"]["message"] == (
        "This transfer cannot be completed right now because it requires additional review."
    )
    assert result["workflowResponse"]["execution"] == {
        "executed": False,
        "operation": "transfer_money",
        "result": None,
    }
    assert result["riskDecision"]["allowed"] is False


@pytest.mark.asyncio
async def test_interrupted_transfer_resume_runs_execution_time_risk_gate():
    thread_id = f"transfer-risk-resume-{uuid4()}"
    calls = []
    services = _services(calls=calls)

    async def fake_llm(payload):
        if payload.get("operation") in {"risk_analysis", "risk_judge"}:
            return await _risk_llm(calls=calls)(payload)
        user_payload = json.loads(payload["messages"][-1]["content"])
        assert user_payload["currentUserMessage"] == "תבצע לי העברה"
        return _completion_response({
            "domain": "transactions",
            "intent": "transfer_money",
            "confidence": 0.98,
            "semanticQuery": None,
            "toolName": "open_money_transfer_inline",
            "transferPayload": None,
        })

    opened = await run_banking_graph(
        user_input="תבצע לי העברה",
        user_id="sender-1",
        user_email="sender@example.com",
        history=[],
        services=services,
        create_chat_completion=fake_llm,
        thread_id=thread_id,
    )

    assert opened["action"]["type"] == "open_money_transfer_inline"

    executed = await run_banking_graph(
        user_input="form submitted",
        user_id="sender-1",
        user_email="sender@example.com",
        history=opened["nextHistory"],
        transfer_payload={"receiverEmail": "receiver@example.com", "amount": 100, "description": "rent"},
        services=services,
        create_chat_completion=fake_llm,
        thread_id=thread_id,
    )

    assert calls == ["risk_analysis", "risk_judge", "execute_transfer"]
    assert "ההעברה הושלמה בהצלחה" in executed["reply"]
    assert services["transactionService"].executed["amount"] == 100.0
