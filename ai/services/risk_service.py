from services.risk_service import assess_transfer_risk


def create_risk_service():
    class RiskService:
        def evaluate_risk(self, payload: dict) -> dict:
            return assess_transfer_risk(
                sender_email=payload.get("senderEmail", ""),
                receiver_email=payload.get("receiverEmail", ""),
                amount=float(payload.get("amount", 0)),
                sender_balance=float(payload.get("senderBalance", 0)),
            )

        # camelCase aliases for JS-style calls
        def evaluateRisk(self, payload: dict) -> dict:
            return self.evaluate_risk(payload)

    return RiskService()
