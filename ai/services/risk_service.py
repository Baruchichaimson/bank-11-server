from services.risk_service import assess_transfer_risk
from observability.langfuse_tracing import duration_ms, now_ms, start_tool


def create_risk_service():
    class RiskService:
        def evaluate_risk(self, payload: dict) -> dict:
            start = now_ms()
            payload = payload or {}
            tool = start_tool(
                name="evaluate_transfer_risk",
                input={
                    "hasSenderEmail": bool(payload.get("senderEmail")),
                    "hasReceiverEmail": bool(payload.get("receiverEmail")),
                    "hasAmount": payload.get("amount") is not None,
                    "hasSenderBalance": payload.get("senderBalance") is not None,
                },
                metadata={"toolName": "evaluate_transfer_risk"},
            )
            try:
                result = assess_transfer_risk(
                    sender_email=payload.get("senderEmail", ""),
                    receiver_email=payload.get("receiverEmail", ""),
                    amount=float(payload.get("amount", 0)),
                    sender_balance=float(payload.get("senderBalance", 0)),
                )
                summary = {
                    "toolName": "evaluate_transfer_risk",
                    "success": True,
                    "requiresReview": bool((result or {}).get("requiresReview")),
                    "reasonCount": len((result or {}).get("reasons") or []),
                    "duration_ms": duration_ms(start),
                }
                tool.end(output=summary, metadata=summary)
                return result
            except Exception as err:
                summary = {"toolName": "evaluate_transfer_risk", "success": False, "error": str(err), "duration_ms": duration_ms(start)}
                tool.end(output=summary, metadata=summary)
                raise

        # camelCase aliases for JS-style calls
        def evaluateRisk(self, payload: dict) -> dict:
            return self.evaluate_risk(payload)

    return RiskService()
