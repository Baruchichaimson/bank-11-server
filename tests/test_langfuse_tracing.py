from observability.langfuse_tracing import (
    flush_langfuse,
    get_langfuse_client,
    is_langfuse_enabled,
    sanitize_for_trace,
    start_span,
    start_trace,
)


def test_langfuse_helpers_are_noop_without_credentials(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    monkeypatch.setenv("LANGFUSE_ENABLED", "false")

    assert is_langfuse_enabled() is False
    assert get_langfuse_client() is None

    trace = start_trace(name="chat_message", input={"message": "hello"})
    span = start_span(name="detect_intent", metadata={"ok": True})
    trace.update(output={"reply": "ok"})
    span.end(output={"done": True})
    flush_langfuse()


def test_sanitize_for_trace_masks_sensitive_fields_and_email(monkeypatch):
    monkeypatch.setenv("LANGFUSE_CAPTURE_IO", "false")

    result = sanitize_for_trace({
        "email": "person@example.com",
        "access_token": "secret",
        "password": "secret",
        "items": [{"id": 1}, {"id": 2}],
        "reply": "Your balance is 1234 ILS for person@example.com",
        "transferPayload": {"receiverEmail": "receiver@example.com", "amount": 250},
    })

    assert result["email"] == "p***@example.com"
    assert result["access_token"] == "[redacted]"
    assert result["password"] == "[redacted]"
    assert result["items"] == {"count": 2}
    assert result["reply"] == "Your balance is [amount] for p***@example.com"
    assert result["transferPayload"] == {
        "present": True,
        "hasReceiverEmail": True,
        "hasAmount": True,
        "hasDescription": False,
        "confirmation": None,
    }
