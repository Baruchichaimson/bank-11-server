from observability.langfuse_tracing import (
    TraceObservation,
    flush_langfuse,
    get_langfuse_client,
    get_current_observation_context,
    is_langfuse_enabled,
    sanitize_for_trace,
    set_trace_context,
    start_span,
    start_tool,
    start_trace,
    reset_trace_context,
)
import observability.langfuse_tracing as langfuse_tracing


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


def test_trace_observation_end_updates_before_v4_end():
    class V4Observation:
        def __init__(self):
            self.updates = []
            self.trace_io = []
            self.ended = False

        def set_trace_io(self, **kwargs):
            self.trace_io.append(kwargs)

        def update(self, **kwargs):
            self.updates.append(kwargs)
            return self

        def end(self):
            self.ended = True
            return self

    observation = V4Observation()
    trace = TraceObservation(observation, is_root=True)

    trace.end(output={"reply": "ok"}, metadata={"duration_ms": 12})

    assert observation.trace_io == [{"output": {"reply": "ok"}}]
    assert observation.updates == [{"output": {"reply": "ok"}, "metadata": {"duration_ms": 12}}]
    assert observation.ended is True


class FakeObservation:
    def __init__(self, *, trace_id=None, observation_id=None):
        self.trace_id = trace_id
        self.id = observation_id
        self.updates = []
        self.ended = False

    def update(self, **kwargs):
        self.updates.append(kwargs)
        return self

    def end(self):
        self.ended = True
        return self


class FakeParentObservation:
    def __init__(self):
        self.started = []

    def start_observation(self, **kwargs):
        observation = FakeObservation()
        self.started.append({**kwargs, "observation": observation})
        return observation


def test_manual_event_updates_then_ends_with_v4_pattern():
    parent = FakeParentObservation()

    event = TraceObservation(parent).event(
        name="user_message_received",
        input={"messageLength": 5},
        output={"success": True},
        metadata={"duration_ms": 1},
    )

    created = parent.started[0]
    observation = created["observation"]
    assert created["name"] == "user_message_received"
    assert created["as_type"] == "event"
    assert observation.updates == [{
        "input": {"messageLength": 5},
        "output": {"success": True},
        "metadata": {"duration_ms": 1},
    }]
    assert observation.ended is True
    event.end(output={"ignored": True})
    assert observation.updates == [{
        "input": {"messageLength": 5},
        "output": {"success": True},
        "metadata": {"duration_ms": 1},
    }]


def test_manual_tool_updates_then_ends_with_v4_pattern():
    parent = FakeParentObservation()

    tool = TraceObservation(parent).tool(
        name="get_balance",
        input={"hasUserId": True},
        metadata={"toolName": "get_balance"},
    )
    tool.end(output={"success": True}, metadata={"duration_ms": 7})

    created = parent.started[0]
    observation = created["observation"]
    assert created["name"] == "get_balance"
    assert created["as_type"] == "tool"
    assert created["input"] == {"hasUserId": True}
    assert created["metadata"] == {"toolName": "get_balance"}
    assert observation.updates == [{"output": {"success": True}, "metadata": {"duration_ms": 7}}]
    assert observation.ended is True


def test_manual_span_behavior_still_updates_then_ends():
    parent = FakeParentObservation()

    span = TraceObservation(parent).span(name="run_banking_graph", input={"history_count": 0})
    span.end(output={"success": True}, metadata={"duration_ms": 11})

    created = parent.started[0]
    observation = created["observation"]
    assert created["name"] == "run_banking_graph"
    assert created["as_type"] == "span"
    assert observation.updates == [{"output": {"success": True}, "metadata": {"duration_ms": 11}}]
    assert observation.ended is True


def test_start_tool_does_not_replace_openai_generation_parent_context():
    parent = FakeParentObservation()
    trace_tokens = set_trace_context(TraceObservation(parent), request_id="req-1")
    current_observation = TraceObservation(FakeObservation(trace_id="trace-1", observation_id="span-1"))
    observation_token = langfuse_tracing._current_observation.set(current_observation)

    try:
        before = get_current_observation_context()
        tool = start_tool(name="get_balance", metadata={"toolName": "get_balance"})
        tool.end(output={"success": True})
        after = get_current_observation_context()
    finally:
        langfuse_tracing._current_observation.reset(observation_token)
        reset_trace_context(trace_tokens)

    assert before == {"trace_id": "trace-1", "parent_observation_id": "span-1"}
    assert after == before
    assert parent.started[0]["as_type"] == "tool"
