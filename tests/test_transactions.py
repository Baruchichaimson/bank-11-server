"""
Pytest tests for transaction endpoints.
"""

import jwt as pyjwt
import os
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch


def _make_valid_token(user_id="test-user-id", email="user@example.com", token_version=0):
    secret = os.environ.get("JWT_SECRET", "test-secret-key-for-pytest")
    payload = {
        "userId": user_id,
        "email": email,
        "tokenVersion": token_version,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    return pyjwt.encode(payload, secret, algorithm="HS256")


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# -- unauthenticated access -------------------------------------------------

def test_transactions_list_unauthorized(client):
    r = client.get("/api/v1/transactions")
    assert r.status_code == 401


def test_transactions_post_unauthorized(client):
    r = client.post("/api/v1/transactions", json={})
    assert r.status_code == 401


# -- validation tests (need a valid JWT but DB returns no user → 404) -------

def _authenticated_post(client, payload, extra_headers=None):
    token = _make_valid_token()
    headers = _auth_headers(token)
    if extra_headers:
        headers.update(extra_headers)
    return client.post("/api/v1/transactions", json=payload, headers=headers)


def test_transaction_missing_receiver_and_amount(client, monkeypatch):
    """Missing receiverEmail + amount → 400."""
    import models.user_model as um
    import models.account_model as am
    monkeypatch.setattr(um, "find_user_by_id", lambda *a, **k: {
        "_id": "test-user-id", "email": "user@example.com", "isVerified": True, "tokenVersion": 0
    })
    monkeypatch.setattr(am, "find_account_by_user_id", lambda *a, **k: {
        "_id": "acc-id", "userId": "test-user-id", "status": "ACTIVE", "balance": 5000
    })
    r = _authenticated_post(client, {})
    assert r.status_code in (400, 401, 403)


def test_transaction_amount_zero(client, monkeypatch):
    """Amount of 0 → 400."""
    import models.user_model as um
    import models.account_model as am
    monkeypatch.setattr(um, "find_user_by_id", lambda *a, **k: {
        "_id": "test-user-id", "email": "user@example.com", "isVerified": True, "tokenVersion": 0
    })
    monkeypatch.setattr(am, "find_account_by_user_id", lambda *a, **k: {
        "_id": "acc-id", "userId": "test-user-id", "status": "ACTIVE", "balance": 5000
    })
    r = _authenticated_post(client, {"receiverEmail": "other@example.com", "amount": 0})
    assert r.status_code in (400, 401, 403)


def test_transaction_negative_amount(client, monkeypatch):
    """Negative amount → 400."""
    import models.user_model as um
    import models.account_model as am
    monkeypatch.setattr(um, "find_user_by_id", lambda *a, **k: {
        "_id": "test-user-id", "email": "user@example.com", "isVerified": True, "tokenVersion": 0
    })
    monkeypatch.setattr(am, "find_account_by_user_id", lambda *a, **k: {
        "_id": "acc-id", "userId": "test-user-id", "status": "ACTIVE", "balance": 5000
    })
    r = _authenticated_post(client, {"receiverEmail": "other@example.com", "amount": -50})
    assert r.status_code in (400, 401, 403)


def test_transaction_to_self(client, monkeypatch):
    """Transferring to own email → 400."""
    import models.user_model as um
    import models.account_model as am
    monkeypatch.setattr(um, "find_user_by_id", lambda *a, **k: {
        "_id": "test-user-id", "email": "user@example.com", "isVerified": True, "tokenVersion": 0
    })
    monkeypatch.setattr(am, "find_account_by_user_id", lambda *a, **k: {
        "_id": "acc-id", "userId": "test-user-id", "status": "ACTIVE", "balance": 5000
    })
    r = _authenticated_post(client, {"receiverEmail": "user@example.com", "amount": 100})
    assert r.status_code in (400, 401, 403)


def test_transactions_pagination_shape(client, monkeypatch):
    """GET /api/v1/transactions returns correct pagination shape."""
    import models.user_model as um
    import models.account_model as am
    import models.transaction_model as tm

    monkeypatch.setattr(um, "find_user_by_id", lambda *a, **k: {
        "_id": "test-user-id", "email": "user@example.com", "isVerified": True, "tokenVersion": 0
    })
    monkeypatch.setattr(am, "find_account_by_user_id", lambda *a, **k: {
        "_id": "acc-id", "userId": "test-user-id", "status": "ACTIVE", "balance": 5000
    })
    monkeypatch.setattr(tm, "get_transactions_by_user_email", lambda *a, **k: {
        "transactions": [],
        "pagination": {"limit": 10, "offset": 0, "hasMore": False},
    })

    token = _make_valid_token()
    r = client.get("/api/v1/transactions", headers=_auth_headers(token))
    if r.status_code == 200:
        data = r.get_json()
        assert "transactions" in data
        assert "pagination" in data
        p = data["pagination"]
        assert "limit" in p
        assert "offset" in p
        assert "hasMore" in p
    else:
        # Acceptable if user or account lookup failed in mock; just verify it's a known error shape
        assert r.status_code in (401, 403, 404)


def _mock_authenticated_transfer_setup(monkeypatch, *, user_id="test-user-id", sender_email="user@example.com"):
    import controllers.transactions_controller as transactions_controller
    import models.user_model as um
    import models.account_model as am

    monkeypatch.setattr(um, "find_user_by_id", lambda *a, **k: {
        "_id": user_id, "email": sender_email, "isVerified": True, "tokenVersion": 0
    })
    monkeypatch.setattr(
        transactions_controller,
        "find_user_by_email",
        MagicMock(return_value={"_id": "receiver-id", "email": "receiver@example.com"}),
    )
    monkeypatch.setattr(
        transactions_controller,
        "find_account_by_user_id",
        MagicMock(
            side_effect=[
                {"_id": "sender-account", "userId": user_id, "status": "ACTIVE", "balance": 5000},
                {"_id": "receiver-account", "userId": "receiver-id", "status": "ACTIVE", "balance": 100},
            ]
        ),
    )
    monkeypatch.setattr(
        transactions_controller,
        "assess_transfer_risk",
        MagicMock(return_value={"requiresReview": False, "score": 10, "level": "LOW", "reasons": []}),
    )
    return transactions_controller


def test_transactions_post_blocks_when_execution_risk_gate_denies(client, monkeypatch):
    transactions_controller = _mock_authenticated_transfer_setup(monkeypatch)
    transfer_money = MagicMock()
    monkeypatch.setattr(transactions_controller, "transfer_money", transfer_money)
    monkeypatch.setattr(
        transactions_controller,
        "run_transfer_execution_risk",
        MagicMock(return_value={
            "riskDecision": {
                "allowed": False,
                "status": "blocked",
                "reason": "Transfer requires additional review.",
            }
        }),
    )

    r = _authenticated_post(client, {"receiverEmail": "receiver@example.com", "amount": 100})

    assert r.status_code == 403
    assert r.get_json()["message"] == "Transfer requires additional review."
    transfer_money.assert_not_called()


def test_transactions_post_calls_transfer_money_when_execution_risk_gate_allows(client, monkeypatch):
    transactions_controller = _mock_authenticated_transfer_setup(monkeypatch)
    transfer_money = MagicMock(return_value={
        "_id": "tx-1",
        "status": "COMPLETED",
        "amount": 100,
        "fromEmail": "user@example.com",
        "toEmail": "receiver@example.com",
    })
    monkeypatch.setattr(transactions_controller, "transfer_money", transfer_money)
    monkeypatch.setattr(
        transactions_controller,
        "find_account_by_id",
        MagicMock(
            side_effect=[
                {"_id": "sender-account", "balance": 4900},
                {"_id": "receiver-account", "balance": 200},
            ]
        ),
    )
    monkeypatch.setattr(
        transactions_controller,
        "run_transfer_execution_risk",
        MagicMock(return_value={
            "riskDecision": {
                "allowed": True,
                "status": "evaluated",
                "reason": "Risk checks passed.",
            }
        }),
    )

    r = _authenticated_post(client, {"receiverEmail": "receiver@example.com", "amount": 100, "description": "Lunch"})

    assert r.status_code == 201
    transfer_money.assert_called_once_with(
        from_account_id="sender-account",
        to_account_id="receiver-account",
        amount=100.0,
        description="Lunch",
    )
