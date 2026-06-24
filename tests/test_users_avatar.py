import jwt

from config.settings import JWT_SECRET
from utils.avatar_utils import avatar_object_name_for_user


def _auth_headers(user_id="user-1", token_version=0):
    token = jwt.encode(
        {
            "userId": user_id,
            "tokenVersion": token_version,
            "email": "avatar@example.com",
        },
        JWT_SECRET,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


def test_get_my_avatar_uses_fallback_object_name_when_missing(client, monkeypatch):
    import controllers.users_controller as users_controller
    import models.user_model as user_model

    expected_object_name = avatar_object_name_for_user("user-abc")

    monkeypatch.setattr(
        user_model,
        "find_user_by_id",
        lambda user_id: {
            "_id": "user-abc",
            "isVerified": True,
            "tokenVersion": 0,
        },
    )

    captured = {}

    def fake_generate_avatar_signed_url(object_name: str) -> str:
        captured["object_name"] = object_name
        return "https://signed.example/avatar.jpg"

    monkeypatch.setattr(users_controller, "generate_avatar_signed_url", fake_generate_avatar_signed_url)

    response = client.get("/api/v1/users/me/avatar", headers=_auth_headers("user-abc"))
    assert response.status_code == 200
    data = response.get_json()
    assert data["avatarUrl"] == "https://signed.example/avatar.jpg"
    assert data["expiresInSeconds"] == 300
    assert captured["object_name"] == expected_object_name
