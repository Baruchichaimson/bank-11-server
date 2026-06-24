"""Helpers for choosing avatar object names."""

from __future__ import annotations

import hashlib
import secrets

AVATAR_OBJECT_PREFIX = "avatars/face-"
AVATAR_OBJECT_SUFFIX = ".jpg"
AVATAR_COUNT = 15


def _format_avatar_index(index: int) -> str:
    return f"{AVATAR_OBJECT_PREFIX}{index:02d}{AVATAR_OBJECT_SUFFIX}"


def random_avatar_object_name() -> str:
    """Return a random avatar object name from the fixed avatar set."""
    return _format_avatar_index(secrets.randbelow(AVATAR_COUNT) + 1)


def avatar_object_name_for_user(user_id) -> str:
    """
    Return a stable avatar object name for a user.

    The mapping is deterministic and does not rely on Python's hash(), which
    changes between processes.
    """
    normalized = str(user_id or "").strip()
    digest = hashlib.sha256(normalized.encode("utf-8")).digest()
    index = (int.from_bytes(digest[:4], "big") % AVATAR_COUNT) + 1
    return _format_avatar_index(index)
