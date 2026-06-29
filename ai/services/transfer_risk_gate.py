from ai.contracts.risk_analysis_contract import normalize_risk_analysis
from ai.contracts.risk_judge_contract import normalize_risk_judge
from ai.llm.llm_router import invoke_llm_json
from ai.shared.json_safe import make_json_safe
from observability.langfuse_tracing import record_event, safe_metadata, start_span, text_preview


def _safe_email(value) -> str:
    return str(value or "").strip().lower()


def _account_balance(account: dict) -> float:
    try:
        return float((account or {}).get("balance") or 0)
    except (TypeError, ValueError):
        return 0.0


def _evaluate_deterministic_risk(*, services: dict | None, payload: dict) -> dict:
    risk_service = (services or {}).get("riskService")
    if not risk_service:
        from ai.services.risk_service import create_risk_service
        risk_service = create_risk_service()

    evaluator = getattr(risk_service, "evaluateRisk", None) or getattr(risk_service, "evaluate_risk", None)
    if not evaluator:
        return {
            "status": "not_evaluated",
            "level": "HIGH",
            "score": None,
            "requiresReview": True,
            "reasons": ["Risk service unavailable."],
        }
    return evaluator(payload)


def _decision_for(*, deterministic_risk: dict, risk_analysis: dict, risk_judge: dict) -> dict:
    if (deterministic_risk or {}).get("requiresReview") is True:
        return {"allowed": False, "status": "blocked", "reason": "Transfer requires additional review."}
    if (risk_analysis or {}).get("level") == "HIGH":
        return {"allowed": False, "status": "blocked", "reason": "Transfer requires additional review."}
    if (risk_judge or {}).get("approval") != "ACCEPTED":
        return {"allowed": False, "status": "blocked", "reason": "Transfer requires additional review."}
    return {"allowed": True, "status": "evaluated", "reason": "Risk checks passed."}


def _summary(*, deterministic_risk: dict, risk_analysis: dict, risk_judge: dict, risk_decision: dict) -> dict:
    return {
        "deterministicRiskLevel": (deterministic_risk or {}).get("level"),
        "deterministicRiskRequiresReview": (deterministic_risk or {}).get("requiresReview"),
        "riskAnalysisLevel": (risk_analysis or {}).get("level"),
        "riskJudgeApproval": (risk_judge or {}).get("approval"),
        "riskDecisionAllowed": (risk_decision or {}).get("allowed"),
        "riskDecisionStatus": (risk_decision or {}).get("status"),
        "reasonPreview": text_preview((risk_decision or {}).get("reason", ""), max_chars=120),
    }


async def evaluate_transfer_execution_risk(
    *,
    sender_user: dict,
    receiver_user: dict,
    sender_account: dict,
    receiver_account: dict,
    amount: float,
    description: str | None,
    services: dict | None,
    create_chat_completion=None,
    abort_signal=None,
) -> dict:
    sender_email = _safe_email((sender_user or {}).get("email"))
    receiver_email = _safe_email((receiver_user or {}).get("email"))
    sender_balance = _account_balance(sender_account)
    remaining_balance = sender_balance - float(amount or 0)

    deterministic_payload = {
        "senderEmail": sender_email,
        "receiverEmail": receiver_email,
        "amount": float(amount or 0),
        "senderBalance": sender_balance,
    }

    span = start_span(
        name="transfer_execution_risk_gate",
        input={
            "hasSenderEmail": bool(sender_email),
            "hasReceiverEmail": bool(receiver_email),
            "amount": float(amount or 0),
            "senderBalance": sender_balance,
        },
        metadata={"operation": "transfer_execution_risk_gate"},
    )

    deterministic_risk = {}
    risk_analysis = {}
    risk_judge = {}
    risk_decision = {"allowed": False, "status": "blocked", "reason": "Transfer requires additional review."}

    try:
        try:
            deterministic_risk = _evaluate_deterministic_risk(services=services, payload=deterministic_payload)
        except Exception as err:
            deterministic_risk = {
                "status": "not_evaluated",
                "level": "HIGH",
                "score": None,
                "requiresReview": True,
                "reasons": [f"Deterministic risk evaluation failed: {err}"],
            }

        record_event(
            name="transfer_execution_deterministic_risk_evaluated",
            metadata=safe_metadata({
                "level": deterministic_risk.get("level"),
                "requiresReview": deterministic_risk.get("requiresReview"),
                "reasonCount": len(deterministic_risk.get("reasons") or []),
            }),
        )

        llm_risk_input = {
            "operation": "risk_analysis",
            "senderEmail": sender_email,
            "receiverEmail": receiver_email,
            "amount": float(amount or 0),
            "senderBalance": sender_balance,
            "remainingBalance": remaining_balance,
            "descriptionPresent": bool(description),
            "deterministicRisk": {
                "level": deterministic_risk.get("level"),
                "score": deterministic_risk.get("score"),
                "requiresReview": deterministic_risk.get("requiresReview"),
                "reasons": list(deterministic_risk.get("reasons") or []),
            },
        }

        try:
            parsed_analysis = await invoke_llm_json(
                "risk_analysis",
                llm_risk_input,
                create_chat_completion=create_chat_completion,
                abort_signal=abort_signal,
            )
        except Exception as err:
            parsed_analysis = {"reason": f"Risk analysis LLM output unavailable or invalid: {err}"}
        risk_analysis = normalize_risk_analysis(parsed_analysis)
        record_event(
            name="transfer_execution_risk_analysis_completed",
            metadata=safe_metadata({
                "operation": "risk_analysis",
                "level": risk_analysis.get("level"),
                "provider": risk_analysis.get("provider"),
                "model": risk_analysis.get("model"),
                "reasonPreview": text_preview(risk_analysis.get("reason", ""), max_chars=120),
            }),
        )

        judge_payload = {
            "operation": "risk_judge",
            "riskInput": {
                "senderEmail": sender_email,
                "receiverEmail": receiver_email,
                "amount": float(amount or 0),
                "senderBalance": sender_balance,
                "remainingBalance": remaining_balance,
                "descriptionPresent": bool(description),
            },
            "deterministicRisk": llm_risk_input["deterministicRisk"],
            "riskAnalysis": risk_analysis,
        }
        try:
            parsed_judge = await invoke_llm_json(
                "risk_judge",
                judge_payload,
                create_chat_completion=create_chat_completion,
                abort_signal=abort_signal,
            )
        except Exception as err:
            parsed_judge = {"reason": f"Risk judge LLM output unavailable or invalid: {err}"}
        risk_judge = normalize_risk_judge(parsed_judge)

        risk_decision = _decision_for(
            deterministic_risk=deterministic_risk,
            risk_analysis=risk_analysis,
            risk_judge=risk_judge,
        )
        summary = _summary(
            deterministic_risk=deterministic_risk,
            risk_analysis=risk_analysis,
            risk_judge=risk_judge,
            risk_decision=risk_decision,
        )
        record_event(name="transfer_execution_risk_judge_completed", metadata=safe_metadata({
            **summary,
            "operation": "risk_judge",
        }))
        record_event(name="transfer_execution_risk_decision_created", metadata=safe_metadata(summary))
        if risk_decision.get("allowed") is False:
            record_event(name="transfer_blocked_by_execution_risk_gate", metadata=safe_metadata(summary))

        return make_json_safe({
            "deterministicRisk": deterministic_risk,
            "riskAnalysis": risk_analysis,
            "riskJudge": risk_judge,
            "riskDecision": risk_decision,
        })
    finally:
        span_summary = _summary(
            deterministic_risk=deterministic_risk,
            risk_analysis=risk_analysis,
            risk_judge=risk_judge,
            risk_decision=risk_decision,
        )
        span.end(output=span_summary, metadata=safe_metadata(span_summary))
