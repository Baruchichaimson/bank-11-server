"""User-specific controller helpers."""

from flask import jsonify, g

from config.settings import GCS_SIGNED_URL_MINUTES
from services.gcs_avatar_service import generate_avatar_signed_url
from utils.avatar_utils import avatar_object_name_for_user


def get_my_avatar():
    try:
        user = getattr(g, "user_record", None) or {}
        object_name = str(user.get("avatarObjectName") or "").strip()
        if not object_name:
            object_name = avatar_object_name_for_user(user.get("_id"))

        signed_url = generate_avatar_signed_url(object_name)
        return jsonify(
            {
                "avatarUrl": signed_url,
                "expiresInSeconds": max(int(GCS_SIGNED_URL_MINUTES or 5), 1) * 60,
            }
        ), 200
    except Exception as err:
        print(f"GET AVATAR ERROR: {err}")
        return jsonify({"message": "Server error"}), 500
