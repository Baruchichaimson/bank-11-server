import importlib
from datetime import datetime, timezone
from unittest.mock import MagicMock

import jwt
import pytest
from flask import Flask, jsonify, g

from config.settings import JWT_SECRET
from middleware.auth import authenticate_token, require_verified_user
from utils.validators import is_valid_email, is_valid_phone


@pytest.fixture(scope="module")
def auth_test_app():
    app = Flask(__name__)
    app.config["TESTING"] = True

    @app.get("/secured")
    @authenticate_token
    @require_verified_user
    def secured():
        return jsonify(
            {
                "userId": g.user_id,
                "email": g.user["email"],
                "verified": g.user_record["isVerified"],
            }
        )

    return app


def _make_token(*, user_id="user-1", email="unit@example.com", token_version=0):
    return jwt.encode(
        {
            "userId": user_id,
            "email": email,
            "tokenVersion": token_version,
        },
        JWT_SECRET,
        algorithm="HS256",
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    ("email", "expected"),
    [
        ("user@example.com", True),
        ("user.name+alias@example.co.il", True),
        ("bad-email", False),
        ("user@localhost", False),
        (" user@example.com ", False),
    ],
)
def test_is_valid_email(email, expected):
    assert is_valid_email(email) is expected


@pytest.mark.unit
@pytest.mark.parametrize(
    ("phone", "expected"),
    [
        ("0501234567", True),
        ("0512345678", True),
        ("052-123-4567", False),
        ("0712345678", False),
        ("050123456", False),
    ],
)
def test_is_valid_phone(phone, expected):
    assert is_valid_phone(phone) is expected


@pytest.mark.unit
def test_get_env_int_raises_on_invalid_value(monkeypatch):
    import config.settings as settings

    monkeypatch.setenv("TEST_INT_VALUE", "not-a-number")

    with pytest.raises(ValueError):
        settings._get_env_int("TEST_INT_VALUE", 7)


@pytest.mark.unit
def test_settings_loads_values_from_dotenv_file(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("JWT_SECRET=from-dotenv\nPORT=4321\n", encoding="utf-8")

    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("PORT", raising=False)

    import config.settings as settings

    reloaded = importlib.reload(settings)
    assert reloaded.JWT_SECRET == "from-dotenv"
    assert reloaded.PORT == 4321

    monkeypatch.setenv("JWT_SECRET", JWT_SECRET)
    monkeypatch.setenv("PORT", "3000")
    importlib.reload(settings)


@pytest.mark.unit
@pytest.mark.parametrize(
    ("headers", "expected_message"),
    [
        ({}, "Authorization token missing"),
        ({"Authorization": "Bearer invalid.token.here"}, "Invalid or expired token"),
    ],
)
def test_authenticate_token_rejects_bad_requests(auth_test_app, monkeypatch, headers, expected_message):
    client = auth_test_app.test_client()

    response = client.get("/secured", headers=headers)

    assert response.status_code == 401
    assert response.get_json()["message"] == expected_message


@pytest.mark.unit
def test_verified_route_returns_user_payload(auth_test_app, monkeypatch):
    import models.user_model as user_model

    finder = MagicMock(
        return_value={
            "_id": "user-1",
            "email": "unit@example.com",
            "isVerified": True,
            "tokenVersion": 3,
        }
    )
    monkeypatch.setattr(user_model, "find_user_by_id", finder)

    client = auth_test_app.test_client()
    response = client.get(
        "/secured",
        headers={"Authorization": f"Bearer {_make_token(token_version=3)}"},
    )

    assert response.status_code == 200
    assert response.get_json() == {
        "userId": "user-1",
        "email": "unit@example.com",
        "verified": True,
    }
    finder.assert_called_once_with("user-1")


@pytest.mark.unit
@pytest.mark.parametrize(
    ("user_record", "expected_status", "expected_message"),
    [
        (
            {"_id": "user-1", "isVerified": False, "tokenVersion": 3},
            403,
            "User is not verified",
        ),
        (
            {"_id": "user-1", "isVerified": True, "tokenVersion": 4},
            401,
            "Session is no longer valid",
        ),
    ],
)
def test_verified_route_rejects_invalid_user_state(auth_test_app, monkeypatch, user_record, expected_status, expected_message):
    import models.user_model as user_model

    monkeypatch.setattr(user_model, "find_user_by_id", MagicMock(return_value=user_record))

    client = auth_test_app.test_client()
    response = client.get(
        "/secured",
        headers={"Authorization": f"Bearer {_make_token(token_version=3)}"},
    )

    assert response.status_code == expected_status
    assert response.get_json()["message"] == expected_message
