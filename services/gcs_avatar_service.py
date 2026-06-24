"""Google Cloud Storage avatar signed URL helper."""

from __future__ import annotations

from datetime import timedelta
from posixpath import normpath

from config.settings import (
    GCS_BUCKET_NAME,
    GCS_SIGNED_URL_MINUTES,
    GCS_SIGNING_SERVICE_ACCOUNT_EMAIL,
)


def _is_safe_object_name(object_name: str) -> bool:
    if not object_name:
        return False

    if object_name.startswith("/") or object_name.startswith("\\"):
        return False

    if "\\" in object_name:
        return False

    parts = object_name.split("/")
    if any(part == ".." for part in parts):
        return False

    normalized = normpath(object_name)
    if normalized in {".", ".."}:
        return False

    if normalized.startswith("../") or normalized.startswith("..\\"):
        return False

    return normalized == object_name


def _get_storage_client_and_credentials():
    try:
        import google.auth
        from google.auth.transport.requests import Request
        from google.cloud import storage
    except ImportError as exc:  # pragma: no cover - only triggered when deps missing
        raise RuntimeError("google-cloud-storage is required for avatar signing") from exc

    credentials, project_id = google.auth.default(
        scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )

    if hasattr(credentials, "refresh") and (not getattr(credentials, "token", None) or not getattr(credentials, "valid", True)):
        credentials.refresh(Request())

    client = storage.Client(project=project_id, credentials=credentials)
    return client, credentials


def generate_avatar_signed_url(object_name: str) -> str:
    """Generate a temporary V4 signed GET URL for a private avatar object."""
    bucket_name = str(GCS_BUCKET_NAME or "").strip()
    if not bucket_name:
        raise RuntimeError("Missing required environment variable: GCS_BUCKET_NAME")

    object_name = str(object_name or "").strip()
    if not object_name:
        raise ValueError("object_name is required")

    if not _is_safe_object_name(object_name):
        raise ValueError("Invalid object_name")

    client, credentials = _get_storage_client_and_credentials()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(object_name)

    signing_email = str(GCS_SIGNING_SERVICE_ACCOUNT_EMAIL or "").strip()
    if not signing_email:
        signing_email = str(getattr(credentials, "service_account_email", "") or "").strip()

    expiration = timedelta(minutes=max(int(GCS_SIGNED_URL_MINUTES or 5), 1))

    signed_url_kwargs = {
        "version": "v4",
        "expiration": expiration,
        "method": "GET",
        "service_account_email": signing_email or None,
        "credentials": credentials,
    }

    try:
        if getattr(credentials, "token", None):
            signed_url_kwargs["access_token"] = credentials.token
        return blob.generate_signed_url(**signed_url_kwargs)
    except TypeError:
        signed_url_kwargs.pop("access_token", None)
        return blob.generate_signed_url(**signed_url_kwargs)
