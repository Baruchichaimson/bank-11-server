import json
from types import SimpleNamespace

import pytest

from ai.graph.banking_graph import (
    create_banking_graph,
    deterministic_risk_node,
    risk_analysis_node,
)


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


def _transfer_state(**overrides):
    state = {
        "userId": "sender-1",
        "history": [{"role": "user", "content": "send money"}],
        "session": {
            "userId": "sender-1",
            "userEmail": "sender@example.com",
            "userLanguage": "en",
        },
        "workflow": {"activeWorkflow": "transfer_workflow"},
        "intent": {
            "intent": "transfer_money",
            "transferPayload": {
                "receiverEmail": "receiver@example.com",
                "amount": 100,
            },
        },
        "transfer": {
            "receiverEmail": "receiver@example.com",
            "amount": 100,
            "senderBalance": 1000,
        },
        "audit": {"transitions": [], "aiDecisions": []},
    }
    state.update(overrides)
    return state


class FixedRiskService:
    def __init__(self, result):
        self.result = result

    def evaluateRisk(self, payload):
        self.payload = payload
        return self.result


def _config(*, create_chat_completion=None, services=None):
    return {
        "configurable": {
            "createChatCompletion": create_chat_completion,
            "services": services or {},
        }
    }


def test_transfer_workflow_routes_through_risk_nodes():
    graph = create_banking_graph().get_graph()
    edges = {(edge.source, edge.target, edge.data) for edge in graph.edges}
    conditional_edges = {
        (edge.source, edge.target)
        for edge in graph.edges
        if edge.conditional
    }

    assert ("workflow_router", "deterministic_risk_node", "transfer_workflow") in edges
    assert ("deterministic_risk_node", "risk_analysis_node", None) in edges
    assert ("risk_analysis_node", "risk_judge_node", None) in edges
    assert ("risk_judge_node", "risk_decision_node", None) in edges
    assert ("risk_decision_node", "transfer_workflow") in conditional_edges
    assert ("risk_decision_node", "blocked_transfer_response_node") in conditional_edges
    assert ("blocked_transfer_response_node", "return_response", None) in edges
    assert ("workflow_router", "balance_workflow", None) in edges
    assert ("workflow_router", "transactions_workflow", None) in edges


@pytest.mark.asyncio
async def test_non_transfer_workflows_do_not_run_risk_analysis():
    async def fail_if_called(_payload):
        raise AssertionError("risk analysis LLM should not be called")

    state = {"workflow": {"activeWorkflow": "balance_workflow"}}

    result = await risk_analysis_node(state, _config(create_chat_completion=fail_if_called))

    assert result is state
    assert "riskAnalysis" not in result


@pytest.mark.asyncio
@pytest.mark.parametrize("level", ["LOW", "MEDIUM", "HIGH"])
async def test_valid_mocked_llm_json_stores_risk_level(level):
    async def fake_llm(payload):
        assert payload["operation"] == "risk_analysis"
        user_payload = json.loads(payload["messages"][-1]["content"])
        assert user_payload["operation"] == "risk_analysis"
        assert user_payload["amount"] == 100
        assert user_payload["deterministicRisk"]["level"] == "LOW"
        return _completion_response(
            json.dumps({"level": level, "reason": "Mocked risk analysis"}),
            model="risk-model",
            provider="test-provider",
        )

    state = _transfer_state(deterministicRisk={"level": "LOW", "score": 10, "requiresReview": False, "reasons": []})

    result = await risk_analysis_node(state, _config(create_chat_completion=fake_llm))

    assert result["riskAnalysis"]["level"] == level
    assert result["riskAnalysis"]["reason"] == "Mocked risk analysis"
    assert result["riskAnalysis"]["model"] == "risk-model"
    assert result["riskAnalysis"]["provider"] == "test-provider"


@pytest.mark.asyncio
async def test_malformed_mocked_llm_output_normalizes_to_high():
    async def fake_llm(_payload):
        return _completion_response("not-json")

    result = await risk_analysis_node(_transfer_state(), _config(create_chat_completion=fake_llm))

    assert result["riskAnalysis"]["level"] == "HIGH"
    assert "invalid" in result["riskAnalysis"]["reason"].lower()


@pytest.mark.asyncio
async def test_deterministic_risk_output_is_preserved_in_state():
    risk_result = {
        "level": "MEDIUM",
        "score": 45,
        "requiresReview": False,
        "reasons": ["High transfer amount"],
        "checks": {"remainingBalance": 900},
    }
    services = {"riskService": FixedRiskService(risk_result)}

    result = await deterministic_risk_node(_transfer_state(), _config(services=services))

    assert result["deterministicRisk"] == risk_result
    assert services["riskService"].payload == {
        "senderEmail": "sender@example.com",
        "receiverEmail": "receiver@example.com",
        "amount": 100.0,
        "senderBalance": 1000.0,
    }


@pytest.mark.asyncio
async def test_risk_nodes_do_not_crash_when_transfer_fields_are_incomplete():
    async def fail_if_called(_payload):
        raise AssertionError("risk analysis LLM should not be called for incomplete transfers")

    incomplete = _transfer_state(
        intent={"intent": "transfer_money", "transferPayload": {}},
        transfer={"receiverEmail": "", "amount": None},
    )

    deterministic = await deterministic_risk_node(incomplete, _config())
    analyzed = await risk_analysis_node(deterministic, _config(create_chat_completion=fail_if_called))

    assert deterministic["deterministicRisk"]["status"] == "not_evaluated"
    assert analyzed["riskAnalysis"]["level"] == "HIGH"
    assert "incomplete" in analyzed["riskAnalysis"]["reason"].lower()
