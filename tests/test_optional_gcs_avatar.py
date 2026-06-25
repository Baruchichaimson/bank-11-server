import importlib.util
from unittest.mock import MagicMock

import pytest


@pytest.mark.skipif(
    importlib.util.find_spec("google.cloud.storage") is None,
    reason="google-cloud-storage is optional in local installs",
)
@pytest.mark.slow
@pytest.mark.unit
def test_generate_avatar_signed_url_uses_bucket_and_signing_email(monkeypatch):
    import services.gcs_avatar_service as gcs_avatar_service

    fake_blob = MagicMock()
    fake_blob.generate_signed_url.return_value = "https://signed.example/avatar.jpg"

    fake_bucket = MagicMock()
    fake_bucket.blob.return_value = fake_blob

    fake_client = MagicMock()
    fake_client.bucket.return_value = fake_bucket

    fake_credentials = MagicMock(
        token="token-123",
        valid=False,
        service_account_email="credentials@example.com",
    )
    fake_credentials.refresh = MagicMock()

    monkeypatch.setattr(gcs_avatar_service, "GCS_BUCKET_NAME", "avatars-bucket")
    monkeypatch.setattr(gcs_avatar_service, "GCS_SIGNED_URL_MINUTES", 5)
    monkeypatch.setattr(gcs_avatar_service, "GCS_SIGNING_SERVICE_ACCOUNT_EMAIL", "")
    monkeypatch.setattr(
        gcs_avatar_service,
        "_get_storage_client_and_credentials",
        MagicMock(return_value=(fake_client, fake_credentials)),
    )

    url = gcs_avatar_service.generate_avatar_signed_url("avatars/face-01.jpg")

    assert url == "https://signed.example/avatar.jpg"
    fake_client.bucket.assert_called_once_with("avatars-bucket")
    fake_bucket.blob.assert_called_once_with("avatars/face-01.jpg")
    fake_blob.generate_signed_url.assert_called_once()
    assert fake_credentials.refresh.called is False
