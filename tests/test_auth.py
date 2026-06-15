"""
Pytest tests for auth endpoints.
"""


def test_signup_missing_fields(client):
    r = client.post("/api/v1/auth/signup", json={})
    assert r.status_code == 400
    data = r.get_json()
    assert "message" in data


def test_signup_invalid_email(client):
    r = client.post(
        "/api/v1/auth/signup",
        json={
            "firstName": "Test",
            "lastName": "User",
            "email": "not-an-email",
            "password": "Password1!",
            "phoneNumber": "0501234567",
        },
    )
    assert r.status_code == 400
    data = r.get_json()
    assert "message" in data


def test_login_missing_fields(client):
    r = client.post("/api/v1/auth/login", json={})
    assert r.status_code == 400
    data = r.get_json()
    assert "message" in data


def test_missing_auth_token_on_accounts(client):
    r = client.get("/api/v1/accounts/me")
    assert r.status_code == 401
    data = r.get_json()
    assert data.get("message") == "Authorization token missing"


def test_invalid_auth_token_on_accounts(client):
    r = client.get(
        "/api/v1/accounts/me",
        headers={"Authorization": "Bearer invalid.token.here"},
    )
    assert r.status_code == 401
    data = r.get_json()
    assert data.get("message") == "Invalid or expired token"
