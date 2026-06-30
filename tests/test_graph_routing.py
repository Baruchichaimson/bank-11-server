import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

from ai.graph.banking_graph import run_banking_graph
from ai.services.business_services import create_business_services


def _completion_response(payload: dict):
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=json.dumps(payload))
            )
        ]
    )


def _fake_llm(payload_by_message: dict):
    async def create_chat_completion(payload):
        user_payload = json.loads(payload["messages"][-1]["content"])
        if payload.get("operation") == "risk_analysis":
            return _completion_response({"level": "LOW", "reason": "Mocked low risk."})
        if payload.get("operation") == "risk_judge":
            return _completion_response({"approval": "ACCEPTED", "reason": "Mocked accepted risk."})
        current = user_payload["currentUserMessage"]
        return _completion_response(payload_by_message[current])

    return create_chat_completion


class AccountService:
    async def get_balance(self, *, user_id, **_):
        return {"found": True, "balance": 1234.0, "status": "ACTIVE", "currency": "ILS"}


class ProfileService:
    async def get_user_profile(self, *, user_id, **_):
        return {"found": True, "firstName": "Dana", "lastName": "Levi", "email": "dana@example.com"}


class TransactionService:
    pass


class TransferProfileService:
    def __init__(self):
        self.sender = {"_id": "sender-1", "email": "dana@example.com"}
        self.receiver = {"_id": "receiver-1", "email": "ron@example.com"}

    def getUserById(self, user_id):
        return self.sender if str(user_id) == str(self.sender["_id"]) else None

    def getUserByEmail(self, email):
        return self.receiver if str(email).lower() == self.receiver["email"] else None


class TransferAccountService:
    def __init__(self):
        self.accounts = {
            "sender-1": {"_id": "account-sender", "userId": "sender-1", "balance": 5000.0},
            "receiver-1": {"_id": "account-receiver", "userId": "receiver-1", "balance": 250.0},
        }

    async def get_account_by_user_id(self, user_id):
        return self.accounts.get(str(user_id))

    async def find_account_by_id(self, account_id):
        for account in self.accounts.values():
            if account["_id"] == account_id:
                return account
        return None


class TransferRiskService:
    def evaluateRisk(self, _payload):
        return {"requiresReview": False}


class TransferTransactionService:
    def __init__(self):
        self.executed = None

    async def execute_transfer(self, **kwargs):
        self.executed = kwargs
        return {"_id": "tx-1", "status": "success", **kwargs}

    async def count_monthly_outgoing_transfers(self, **_kwargs):
        return 1


def _services():
    return {
        "accountService": AccountService(),
        "profileService": ProfileService(),
        "transactionService": TransactionService(),
    }


def _transfer_services():
    transaction_service = TransferTransactionService()
    return {
        "accountService": TransferAccountService(),
        "profileService": TransferProfileService(),
        "transactionService": transaction_service,
        "riskService": TransferRiskService(),
    }


def _thread_id(name: str) -> str:
    return f"{name}-{uuid4()}"


@pytest.mark.asyncio
async def test_llm_balance_intent_routes_to_balance_workflow():
    result = await run_banking_graph(
        user_input="מה היתרה שלי",
        user_id="user-1",
        user_email="dana@example.com",
        history=[],
        create_chat_completion=_fake_llm({
            "מה היתרה שלי": {
                "domain": "account",
                "intent": "check_balance",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": None,
            }
        }),
        services=_services(),
        thread_id=_thread_id("balance"),
    )

    assert "יתרה" in result["reply"]
    assert "1234" in result["reply"]


@pytest.mark.asyncio
async def test_llm_profile_intent_routes_to_personal_details_workflow():
    result = await run_banking_graph(
        user_input="מה השם שלי?",
        user_id="user-1",
        user_email="dana@example.com",
        history=[],
        create_chat_completion=_fake_llm({
            "מה השם שלי?": {
                "domain": "profile",
                "intent": "show_personal_details",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": None,
            }
        }),
        services=_services(),
        thread_id=_thread_id("profile"),
    )

    assert "Dana" in result["reply"]
    assert "Levi" in result["reply"]


@pytest.mark.asyncio
async def test_llm_transfer_intent_routes_to_transfer_workflow():
    result = await run_banking_graph(
        user_input="תבצע לי העברה",
        user_id="user-1",
        user_email="dana@example.com",
        history=[],
        create_chat_completion=_fake_llm({
            "תבצע לי העברה": {
                "domain": "transactions",
                "intent": "transfer_money",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": "open_money_transfer_inline",
                "transferPayload": None,
            }
        }),
        services=_services(),
        thread_id=_thread_id("transfer"),
    )

    assert result["nextTransferState"] == {"phase": "form_open"}
    assert result["action"]["type"] == "open_money_transfer_inline"


@pytest.mark.asyncio
async def test_inline_transfer_form_executes_small_amount_without_confirmation():
    thread_id = _thread_id("transfer-form")
    services = _transfer_services()

    opened = await run_banking_graph(
        user_input="תבצע לי העברה",
        user_id="sender-1",
        user_email="dana@example.com",
        history=[],
        create_chat_completion=_fake_llm({
            "תבצע לי העברה": {
                "domain": "transactions",
                "intent": "transfer_money",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": "open_money_transfer_inline",
                "transferPayload": None,
            }
        }),
        services=services,
        thread_id=thread_id,
    )

    assert opened["nextTransferState"]["phase"] == "form_open"
    assert opened["action"] == {"type": "open_money_transfer_inline", "language": "he"}

    executed = await run_banking_graph(
        user_input="פרטי העברה נשלחו מהטופס",
        user_id="sender-1",
        user_email="dana@example.com",
        history=opened["nextHistory"],
        transfer_payload={
            "receiverEmail": "ron@example.com",
            "amount": 100,
            "description": "rent",
        },
        create_chat_completion=_fake_llm({}),
        services=services,
        thread_id=thread_id,
    )

    assert executed["nextTransferState"] is None
    assert executed["action"] is None
    assert "ההעברה הושלמה בהצלחה" in executed["reply"]
    assert services["transactionService"].executed["amount"] == 100.0


@pytest.mark.asyncio
async def test_inline_transfer_form_requires_confirmation_only_for_high_amount():
    thread_id = _thread_id("transfer-high-amount")
    services = _transfer_services()

    opened = await run_banking_graph(
        user_input="תבצע לי העברה",
        user_id="sender-1",
        user_email="dana@example.com",
        history=[],
        create_chat_completion=_fake_llm({
            "תבצע לי העברה": {
                "domain": "transactions",
                "intent": "transfer_money",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": "open_money_transfer_inline",
                "transferPayload": None,
            }
        }),
        services=services,
        thread_id=thread_id,
    )

    confirmation = await run_banking_graph(
        user_input="פרטי העברה נשלחו מהטופס",
        user_id="sender-1",
        user_email="dana@example.com",
        history=opened["nextHistory"],
        transfer_payload={
            "receiverEmail": "ron@example.com",
            "amount": 1500,
            "description": "rent",
        },
        create_chat_completion=_fake_llm({}),
        services=services,
        thread_id=thread_id,
    )

    assert confirmation["nextTransferState"]["phase"] == "await_confirmation"
    assert confirmation["action"]["type"] == "transfer_high_amount_confirm"
    assert services["transactionService"].executed is None

    executed = await run_banking_graph(
        user_input="כן",
        user_id="sender-1",
        user_email="dana@example.com",
        history=confirmation["nextHistory"],
        transfer_payload={"confirmation": "yes"},
        create_chat_completion=_fake_llm({}),
        services=services,
        thread_id=thread_id,
    )

    assert executed["nextTransferState"] is None
    assert "ההעברה הושלמה בהצלחה" in executed["reply"]
    assert services["transactionService"].executed["amount"] == 1500.0


@pytest.mark.asyncio
@pytest.mark.parametrize("message", ["מה קורה?", "מה נשמע?", "שלום"])
async def test_casual_greeting_routes_to_unknown_workflow(message):
    result = await run_banking_graph(
        user_input=message,
        user_id="user-1",
        user_email="dana@example.com",
        history=[],
        create_chat_completion=_fake_llm({
            message: {
                "domain": "support",
                "intent": "contact_support",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": "open_video_call_window",
            }
        }),
        services=_services(),
        thread_id=_thread_id("casual-greeting"),
    )

    assert result["action"] is None
    assert "עוזר בנקאי" in result["reply"] or "banking assistant" in result["reply"]


@pytest.mark.asyncio
@pytest.mark.parametrize("message", ["פתח לי שיחת וידאו", "אני צריך נציג"])
async def test_explicit_support_routes_to_video_call_action(message):
    result = await run_banking_graph(
        user_input=message,
        user_id="user-1",
        user_email="dana@example.com",
        history=[],
        create_chat_completion=_fake_llm({
            message: {
                "domain": "support",
                "intent": "contact_support",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": "open_video_call_window",
            }
        }),
        services=create_business_services(),
        thread_id=_thread_id("support"),
    )

    action = result.get("action")
    action_type = action.get("type") if isinstance(action, dict) else action
    assert action_type == "open_video_call"


@pytest.mark.asyncio
async def test_prior_balance_history_does_not_override_current_profile_intent():
    result = await run_banking_graph(
        user_input="מה השם שלי?",
        user_id="user-1",
        user_email="dana@example.com",
        history=[
            {"role": "user", "content": "מה היתרה שלי"},
            {"role": "assistant", "content": "היתרה שלך היא 1234 ILS."},
        ],
        create_chat_completion=_fake_llm({
            "מה השם שלי?": {
                "domain": "profile",
                "intent": "show_personal_details",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": None,
            }
        }),
        services=_services(),
        thread_id=_thread_id("history-profile"),
    )

    assert "Dana" in result["reply"]
    assert "יתרה" not in result["reply"]


@pytest.mark.asyncio
async def test_prior_transactions_history_does_not_override_current_balance_intent():
    result = await run_banking_graph(
        user_input="מה היתרה שלי",
        user_id="user-1",
        user_email="dana@example.com",
        history=[
            {"role": "user", "content": "תראה לי את ההעברות האחרונות"},
            {"role": "assistant", "content": "מצאתי העברות אחרונות."},
        ],
        create_chat_completion=_fake_llm({
            "מה היתרה שלי": {
                "domain": "account",
                "intent": "check_balance",
                "confidence": 0.98,
                "semanticQuery": None,
                "toolName": None,
            }
        }),
        services=_services(),
        thread_id=_thread_id("history-balance"),
    )

    assert "יתרה" in result["reply"]
    assert "1234" in result["reply"]
