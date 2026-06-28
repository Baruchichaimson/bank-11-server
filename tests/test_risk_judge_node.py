import json
from types import SimpleNamespace

import pytest

from ai.graph.banking_graph import risk_judge_node


def _completion_response(content, *, model=None, provider=None):
    return SimpleNamespace(
        model=model,
        provider=provider,
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content)
            )
        ],
    )


def _config(*, create_chat_completion=None):
    return {"configurable": {"createChatCompletion": create_chat_completion, "services": {}}}


def _transfer_state(**overrides):
    state = {
        "userId": "sender-1",
        "history": [{"role": "user", "content": "send 100 shekels"}],
        "session": {
            "userId": "sender-1",
            "userEmail": "sender@example.com",
            "userLanguage": "en",
        },
        "workflow": {"activeWorkflow": "transfer_workflow"},
        "intent": {"intent": "transfer_money", "transferPayload": {}},
        "transfer": {
            "receiverEmail": "receiver@example.com",
            "amount": 100,
            "senderBalance": 1000,
        },
        "deterministicRisk": {
            "level": "LOW",
            "score": 10,
            "requiresReview": False,
            "reasons": [],
        },
        "riskAnalysis": {
            "level": "LOW",
            "reason": "Small transfer.",
            "model": None,
            "provider": None,
            "raw": {},
        },
        "audit": {"transitions": [], "aiDecisions": []},
    }
    state.update(overrides)
    return state


@pytest.mark.asyncio
async def test_risk_judge_accepts_valid_mocked_llm_json():
    async def fake_llm(payload):
        assert payload["operation"] == "risk_judge"
        user_payload = json.loads(payload["messages"][-1]["content"])
        assert user_payload["operation"] == "risk_judge"
        assert user_payload["riskInput"]["amount"] == 100
        assert user_payload["deterministicRisk"]["level"] == "LOW"
        assert user_payload["riskAnalysis"]["level"] == "LOW"
        return _completion_response(
            json.dumps({"approval": "ACCEPTED", "reason": "Risk analysis is consistent."}),
            model="judge-model",
            provider="test-provider",
        )

    result = await risk_judge_node(_transfer_state(), _config(create_chat_completion=fake_llm))

    assert result["riskJudge"]["approval"] == "ACCEPTED"
    assert result["riskJudge"]["reason"] == "Risk analysis is consistent."
    assert result["riskJudge"]["model"] == "judge-model"
    assert result["riskJudge"]["provider"] == "test-provider"
    assert result["audit"]["aiDecisions"][-1]["status"] == "evaluated"
    assert result["audit"]["aiDecisions"][-1]["reasonPreview"]["preview"] == "Risk analysis is consistent."


@pytest.mark.asyncio
async def test_malformed_risk_judge_output_denies_safely():
    async def fake_llm(_payload):
        return _completion_response("not-json")

    result = await risk_judge_node(_transfer_state(), _config(create_chat_completion=fake_llm))

    assert result["riskJudge"]["approval"] == "DENIED"
    assert "invalid" in result["riskJudge"]["reason"].lower()
    assert result["audit"]["aiDecisions"][-1]["status"] == "failed"


@pytest.mark.asyncio
async def test_incomplete_transfer_data_skips_judge_without_denial():
    async def fail_if_called(_payload):
        raise AssertionError("risk judge should not run for incomplete transfer data")

    state = _transfer_state(transfer={"receiverEmail": "", "amount": None})

    result = await risk_judge_node(state, _config(create_chat_completion=fail_if_called))

    assert result["riskJudge"]["status"] == "not_evaluated"
    assert result["riskJudge"]["approval"] is None
    assert "incomplete" in result["riskJudge"]["reason"].lower()
    assert result["audit"]["aiDecisions"][-1]["status"] == "not_evaluated"


@pytest.mark.asyncio
async def test_non_transfer_workflow_does_not_run_judge():
    async def fail_if_called(_payload):
        raise AssertionError("risk judge should not be called")

    state = {"workflow": {"activeWorkflow": "balance_workflow"}}

    result = await risk_judge_node(state, _config(create_chat_completion=fail_if_called))

    assert result is state
    assert "riskJudge" not in result
