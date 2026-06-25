import jwt
import pytest
from unittest.mock import MagicMock

from config.settings import JWT_SECRET


def _auth_headers(*, user_id="user-1", email="api@example.com", token_version=3):
    token = jwt.encode(
        {
            "userId": user_id,
            "email": email,
            "tokenVersion": token_version,
        },
        JWT_SECRET,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.api
def test_signup_happy_path_creates_user_and_sends_verification_email(client, monkeypatch):
    import controllers.auth_controller as auth_controller

    create_user = MagicMock(return_value={"_id": "user-1"})
    send_verification_email = MagicMock()

    monkeypatch.setattr(auth_controller, "find_user_by_email", MagicMock(return_value=None))
    monkeypatch.setattr(auth_controller, "find_user_by_phone_number", MagicMock(return_value=None))
    monkeypatch.setattr(auth_controller, "create_user", create_user)
    monkeypatch.setattr(auth_controller, "send_verification_email", send_verification_email)
    monkeypatch.setattr(auth_controller, "random_avatar_object_name", MagicMock(return_value="avatars/face-01.jpg"))

    response = client.post(
        "/api/v1/auth/signup",
        json={
            "firstName": "Test",
            "lastName": "User",
            "email": "test@example.com",
            "phoneNumber": "0501234567",
            "password": "Password1!",
        },
    )

    assert response.status_code == 201
    assert response.get_json()["message"] == "Registration successful. Please verify your email."
    create_user.assert_called_once()
    send_verification_email.assert_called_once()


@pytest.mark.api
def test_accounts_me_happy_path_returns_account_and_transactions(client, monkeypatch):
    import controllers.accounts_controller as accounts_controller
    import models.user_model as user_model

    monkeypatch.setattr(
        user_model,
        "find_user_by_id",
        MagicMock(
            return_value={
                "_id": "user-1",
                "email": "api@example.com",
                "isVerified": True,
                "tokenVersion": 3,
            }
        ),
    )
    monkeypatch.setattr(
        accounts_controller,
        "find_account_by_user_id",
        MagicMock(
            return_value={
                "_id": "account-1",
                "userId": "user-1",
                "balance": 2500,
                "status": "ACTIVE",
            }
        ),
    )
    monkeypatch.setattr(
        accounts_controller,
        "find_transactions_by_user_id",
        MagicMock(
            return_value=[
                {
                    "_id": "tx-1",
                    "fromEmail": "api@example.com",
                    "toEmail": "friend@example.com",
                    "amount": 125,
                    "createdAt": "2026-06-18T12:00:00+00:00",
                }
            ]
        ),
    )

    response = client.get(
        "/api/v1/accounts/me?transactionsLimit=2&transactionsOffset=1",
        headers=_auth_headers(),
    )

    assert response.status_code == 200
    data = response.get_json()
    assert data["account"]["balance"] == 2500
    assert data["pagination"] == {"limit": 2, "offset": 1}
    assert data["transactions"][0]["sign"] == "-"


@pytest.mark.api
def test_transactions_create_happy_path_returns_completed_transaction(client, monkeypatch):
    import controllers.transactions_controller as transactions_controller
    import models.user_model as user_model

    monkeypatch.setattr(
        user_model,
        "find_user_by_email",
        MagicMock(return_value={"_id": "user-2", "email": "receiver@example.com"}),
    )
    monkeypatch.setattr(
        transactions_controller,
        "find_account_by_user_id",
        MagicMock(
            side_effect=[
                {"_id": "sender-account", "userId": "user-1", "balance": 5000, "status": "ACTIVE"},
                {"_id": "receiver-account", "userId": "user-2", "balance": 100, "status": "ACTIVE"},
            ]
        ),
    )
    monkeypatch.setattr(
        transactions_controller,
        "assess_transfer_risk",
        MagicMock(return_value={"requiresReview": False, "score": 10, "level": "LOW", "reasons": []}),
    )
    monkeypatch.setattr(
        transactions_controller,
        "transfer_money",
        MagicMock(
            return_value={
                "_id": "tx-1",
                "status": "COMPLETED",
                "amount": 100,
                "fromEmail": "api@example.com",
                "toEmail": "receiver@example.com",
            }
        ),
    )
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

    response = client.post(
        "/api/v1/transactions",
        headers=_auth_headers(),
        json={
            "receiverEmail": "receiver@example.com",
            "amount": 100,
            "description": "Lunch",
            "riskConfirmed": False,
        },
    )

    assert response.status_code == 201
    data = response.get_json()
    assert data["message"] == "Transaction completed"
    assert data["senderBalance"] == 4900
    assert data["receiverBalance"] == 200
    assert data["transaction"]["status"] == "COMPLETED"
