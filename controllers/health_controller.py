from datetime import datetime, timezone
from flask import jsonify
from ai.assistant.openai_client import AI_PROVIDER, OPENAI_MODEL, has_openai_key


def get_health():
    return jsonify({"status": "OK", "time": datetime.now(timezone.utc).isoformat()}), 200


def get_health_ai():
    return jsonify(
        {
            "status": "OK",
            "ai": {
                "provider": AI_PROVIDER,
                "hasApiKey": has_openai_key,
                "model": OPENAI_MODEL,
            },
            "time": datetime.now(timezone.utc).isoformat(),
        }
    ), 200
