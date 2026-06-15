"""
Pytest tests for accounts endpoints.
"""


def test_accounts_me_unauthorized_no_token(client):
    r = client.get("/api/v1/accounts/me")
    assert r.status_code == 401
    data = r.get_json()
    assert data.get("message") == "Authorization token missing"


def test_accounts_me_unauthorized_bad_token(client):
    r = client.get(
        "/api/v1/accounts/me",
        headers={"Authorization": "Bearer bad.token.value"},
    )
    assert r.status_code == 401
    data = r.get_json()
    assert data.get("message") == "Invalid or expired token"
