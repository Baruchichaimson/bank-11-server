from ai.contracts.assistant_response_contract import create_workflow_response
from ai.contracts.intent_result_contract import create_intent_result


def test_intent_result_accepts_js_style_aliases():
    result = create_intent_result(
        domain="account",
        intent="check_balance",
        workflowContinuation={"active": True},
        semanticQuery={"domain": "account"},
        transferPayload={"amount": 10},
        toolName="get_balance",
        toolArgs={"currency": "ILS"},
        isAmbiguous=True,
        ambiguityReason="needs clarification",
    )

    assert result["workflowContinuation"] == {"active": True}
    assert result["semanticQuery"] == {"domain": "account"}
    assert result["transferPayload"] == {"amount": 10}
    assert result["tool"] == {"name": "get_balance", "args": {"currency": "ILS"}}
    assert result["ambiguity"]["isAmbiguous"] is True
    assert result["ambiguity"]["reason"] == "needs clarification"


def test_workflow_response_accepts_js_style_next_state_alias():
    result = create_workflow_response(
        message="ok",
        nextConversationState={"phase": "form_open"},
        execution={"executed": True, "operation": "get_balance", "result": {"balance": 10}},
    )

    assert result["message"] == "ok"
    assert result["nextConversationState"] == {"phase": "form_open"}
    assert result["execution"] == {
        "executed": True,
        "operation": "get_balance",
        "result": {"balance": 10},
    }
