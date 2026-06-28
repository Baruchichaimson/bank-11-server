import pytest

from ai.graph.banking_graph import (
    _route_after_risk_decision,
    blocked_transfer_response_node,
    risk_decision_node,
)


def _config():
    return {"configurable": {"services": {}}}


def _state(*, analysis_level="LOW", judge_approval="ACCEPTED", deterministic_level="LOW", requires_review=False, transfer=None):
    return {
        "userId": "sender-1",
        "session": {
            "userId": "sender-1",
            "userEmail": "sender@example.com",
            "userLanguage": "en",
        },
        "workflow": {"activeWorkflow": "transfer_workflow"},
        "intent": {"intent": "transfer_money", "transferPayload": {}},
        "transfer": transfer if transfer is not None else {
            "receiverEmail": "receiver@example.com",
            "amount": 100,
            "senderBalance": 1000,
        },
        "riskAnalysis": {
            "level": analysis_level,
            "reason": "analysis",
            "model": None,
            "provider": None,
            "raw": {},
        },
        "riskJudge": {
            "approval": judge_approval,
            "reason": "judge",
            "model": None,
            "provider": None,
            "raw": {},
        },
        "deterministicRisk": {
            "level": deterministic_level,
            "score": 10,
            "requiresReview": requires_review,
            "reasons": [],
        },
        "audit": {"transitions": [], "aiDecisions": []},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("level", ["LOW", "MEDIUM"])
async def test_low_or_medium_analysis_with_accepted_judge_and_low_deterministic_allows_transfer(level):
    result = await risk_decision_node(_state(analysis_level=level), _config())

    assert result["riskDecision"]["allowed"] is True
    assert "Risk checks passed" in result["riskDecision"]["reason"]
    assert result["audit"]["aiDecisions"][-1]["status"] == "evaluated"
    assert result["audit"]["aiDecisions"][-1]["allowed"] is True
    assert "risk" in result["audit"]["aiDecisions"][-1]["reasonPreview"]["preview"].lower()
    assert await _route_after_risk_decision(result) == "transfer_workflow"


@pytest.mark.asyncio
async def test_high_risk_analysis_denies_transfer():
    result = await risk_decision_node(_state(analysis_level="HIGH"), _config())

    assert result["riskDecision"]["allowed"] is False
    assert await _route_after_risk_decision(result) == "blocked_transfer_response_node"


@pytest.mark.asyncio
async def test_denied_judge_denies_transfer():
    result = await risk_decision_node(_state(judge_approval="DENIED"), _config())

    assert result["riskDecision"]["allowed"] is False
    assert await _route_after_risk_decision(result) == "blocked_transfer_response_node"


@pytest.mark.asyncio
async def test_deterministic_high_denies_transfer():
    result = await risk_decision_node(_state(deterministic_level="HIGH"), _config())

    assert result["riskDecision"]["allowed"] is False
    assert await _route_after_risk_decision(result) == "blocked_transfer_response_node"


@pytest.mark.asyncio
async def test_deterministic_requires_review_denies_transfer():
    result = await risk_decision_node(_state(requires_review=True), _config())

    assert result["riskDecision"]["allowed"] is False
    assert await _route_after_risk_decision(result) == "blocked_transfer_response_node"


@pytest.mark.asyncio
async def test_incomplete_transfer_data_does_not_block_field_collection():
    result = await risk_decision_node(_state(transfer={"receiverEmail": "", "amount": None}), _config())

    assert result["riskDecision"]["allowed"] is True
    assert result["riskDecision"]["status"] == "not_evaluated"
    assert await _route_after_risk_decision(result) == "transfer_workflow"


@pytest.mark.asyncio
async def test_blocked_transfer_response_uses_safe_workflow_response_shape():
    result = await blocked_transfer_response_node({
        **_state(analysis_level="HIGH"),
        "riskDecision": {"allowed": False, "reason": "internal risk details"},
    })

    assert result["workflowResponse"]["message"] == (
        "This transfer cannot be completed right now because it requires additional review."
    )
    assert result["workflowResponse"]["execution"] == {
        "executed": False,
        "operation": "transfer_money",
        "result": None,
    }
