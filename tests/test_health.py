"""
Pytest tests for health endpoints.
"""


def test_health_ok(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    data = r.get_json()
    assert data.get("status", "").upper() == "OK"


def test_health_ai_ok(client):
    r = client.get("/api/v1/health/ai")
    assert r.status_code == 200
    data = r.get_json()
    assert data.get("status", "").upper() == "OK"
    assert "ai" in data
