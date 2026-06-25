from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from services.risk_service import assess_transfer_risk


class FakeTransactionsCollection:
    def __init__(self, *, has_history: bool, recent_count: int):
        self.has_history = has_history
        self.recent_count = recent_count
        self.find_one_calls = []
        self.count_documents_calls = []

    def find_one(self, query):
        self.find_one_calls.append(query)
        return {"_id": "tx-1"} if self.has_history else None

    def count_documents(self, query):
        self.count_documents_calls.append(query)
        return self.recent_count


class FakeDB:
    def __init__(self, transactions):
        self._transactions = transactions

    def __getitem__(self, name):
        assert name == "transactions"
        return self._transactions


@pytest.fixture(scope="module")
def reference_now():
    return datetime(2026, 6, 18, 12, 0, tzinfo=timezone.utc)


@pytest.mark.unit
@pytest.mark.parametrize(
    (
        "amount",
        "sender_balance",
        "has_history",
        "recent_count",
        "expected_level",
        "expected_score",
        "expected_reason",
    ),
    [
        (100, 1000, True, 0, "LOW", 0, []),
        (10_000, 12_500, True, 0, "MEDIUM", 45, ["High transfer amount"]),
        (
            20_000,
            50,
            False,
            5,
            "HIGH",
            230,
            [
                "Very high transfer amount",
                "First transfer to this beneficiary",
                "High transfer velocity in last hour",
                "Insufficient funds after transfer",
            ],
        ),
    ],
)
def test_assess_transfer_risk_scores_and_reasons(
    monkeypatch,
    amount,
    sender_balance,
    has_history,
    recent_count,
    expected_level,
    expected_score,
    expected_reason,
):
    import services.risk_service as risk_service

    transactions = FakeTransactionsCollection(
        has_history=has_history,
        recent_count=recent_count,
    )
    monkeypatch.setattr(risk_service, "get_db", lambda: FakeDB(transactions))

    result = assess_transfer_risk(
        sender_email="sender@example.com",
        receiver_email="receiver@example.com",
        amount=amount,
        sender_balance=sender_balance,
    )

    assert result["level"] == expected_level
    assert result["score"] == expected_score
    assert result["reasons"] == expected_reason
    assert result["checks"]["amount"] == pytest.approx(float(amount))
    assert result["checks"]["remainingBalance"] == pytest.approx(sender_balance - amount)
    assert result["checks"]["hasBeneficiaryHistory"] is has_history
    assert result["checks"]["recentOutgoingCount"] == recent_count


@pytest.mark.unit
def test_cleanup_expired_pending_registrations_no_expired_users(monkeypatch):
    import models.account_model as account_model
    import models.user_model as user_model
    import utils.pending_registration_cleanup as cleanup

    find_expired = MagicMock(return_value=[])
    delete_accounts = MagicMock()
    delete_users = MagicMock()

    monkeypatch.setattr(user_model, "find_expired_unverified_users", find_expired)
    monkeypatch.setattr(account_model, "delete_pending_accounts_by_user_ids", delete_accounts)
    monkeypatch.setattr(user_model, "delete_expired_unverified_users_by_ids", delete_users)

    result = cleanup.cleanup_expired_pending_registrations()

    assert result == {"deletedUsers": 0, "deletedAccounts": 0}
    find_expired.assert_called_once()
    delete_accounts.assert_not_called()
    delete_users.assert_not_called()


@pytest.mark.unit
def test_cleanup_expired_pending_registrations_deletes_related_records(monkeypatch):
    import models.account_model as account_model
    import models.user_model as user_model
    import utils.pending_registration_cleanup as cleanup

    expired_users = [
        {"_id": "user-1"},
        {"_id": "user-2"},
    ]
    delete_accounts = MagicMock(return_value={"deletedCount": 2})
    delete_users = MagicMock(return_value={"deletedCount": 1})

    monkeypatch.setattr(user_model, "find_expired_unverified_users", MagicMock(return_value=expired_users))
    monkeypatch.setattr(account_model, "delete_pending_accounts_by_user_ids", delete_accounts)
    monkeypatch.setattr(user_model, "delete_expired_unverified_users_by_ids", delete_users)

    result = cleanup.cleanup_expired_pending_registrations()

    assert result == {"deletedUsers": 1, "deletedAccounts": 2}
    delete_accounts.assert_called_once_with(["user-1", "user-2"])
    assert delete_users.call_count == 1


@pytest.mark.unit
def test_run_cleanup_logs_success(caplog, monkeypatch):
    import utils.pending_registration_cleanup as cleanup

    monkeypatch.setattr(
        cleanup,
        "cleanup_expired_pending_registrations",
        MagicMock(return_value={"deletedUsers": 1, "deletedAccounts": 2}),
    )

    with caplog.at_level("INFO"):
        cleanup._run_cleanup()

    assert "Cleaned expired pending registrations: users=1, accounts=2" in caplog.text


@pytest.mark.unit
def test_run_cleanup_logs_failures(caplog, monkeypatch):
    import utils.pending_registration_cleanup as cleanup

    monkeypatch.setattr(
        cleanup,
        "cleanup_expired_pending_registrations",
        MagicMock(side_effect=RuntimeError("boom")),
    )

    with caplog.at_level("ERROR"):
        cleanup._run_cleanup()

    assert "Pending registration cleanup failed: boom" in caplog.text
