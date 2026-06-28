from ai.contracts.risk_analysis_contract import (
    DEFAULT_RISK_REASON,
    normalize_risk_analysis,
)
from ai.contracts.risk_judge_contract import (
    DEFAULT_JUDGE_REASON,
    normalize_risk_judge,
)


def test_risk_analysis_contract_accepts_valid_json():
    payload = {
        "level": "LOW",
        "reason": "Known beneficiary and small amount.",
        "model": "risk-model",
        "provider": "test-provider",
    }

    result = normalize_risk_analysis(payload)

    assert result == {
        "level": "LOW",
        "reason": "Known beneficiary and small amount.",
        "model": "risk-model",
        "provider": "test-provider",
        "raw": payload,
    }


def test_risk_judge_contract_accepts_valid_json():
    payload = {
        "approval": "ACCEPTED",
        "reason": "Risk controls passed.",
        "model": "judge-model",
        "provider": "test-provider",
    }

    result = normalize_risk_judge(payload)

    assert result == {
        "approval": "ACCEPTED",
        "reason": "Risk controls passed.",
        "model": "judge-model",
        "provider": "test-provider",
        "raw": payload,
    }


def test_risk_contracts_use_safe_defaults_for_missing_fields():
    analysis = normalize_risk_analysis({})
    judge = normalize_risk_judge({})

    assert analysis == {
        "level": "HIGH",
        "reason": DEFAULT_RISK_REASON,
        "model": None,
        "provider": None,
        "raw": {},
    }
    assert judge == {
        "approval": "DENIED",
        "reason": DEFAULT_JUDGE_REASON,
        "model": None,
        "provider": None,
        "raw": {},
    }


def test_risk_analysis_contract_defaults_invalid_level_to_high():
    result = normalize_risk_analysis({"level": "UNKNOWN", "reason": "bad level"})

    assert result["level"] == "HIGH"
    assert result["reason"] == "bad level"


def test_risk_judge_contract_defaults_invalid_approval_to_denied():
    result = normalize_risk_judge({"approval": "MAYBE", "reason": "bad approval"})

    assert result["approval"] == "DENIED"
    assert result["reason"] == "bad approval"


def test_risk_contracts_handle_non_dict_input():
    analysis = normalize_risk_analysis("not-json")
    judge = normalize_risk_judge(["not", "json"])

    assert analysis == {
        "level": "HIGH",
        "reason": DEFAULT_RISK_REASON,
        "model": None,
        "provider": None,
        "raw": {},
    }
    assert judge == {
        "approval": "DENIED",
        "reason": DEFAULT_JUDGE_REASON,
        "model": None,
        "provider": None,
        "raw": {},
    }
