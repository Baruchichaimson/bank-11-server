"""
Risk assessment service — exact port of ai/riskAssessment.js.
"""

from datetime import datetime, timezone, timedelta
from config.db import get_db

HIGH_RISK_THRESHOLD = 70
MEDIUM_RISK_THRESHOLD = 40
ONE_HOUR = timedelta(hours=1)


def _get_risk_level(score: float) -> str:
    if score >= HIGH_RISK_THRESHOLD:
        return "HIGH"
    if score >= MEDIUM_RISK_THRESHOLD:
        return "MEDIUM"
    return "LOW"


def _has_beneficiary_history(sender_email: str, receiver_email: str) -> bool:
    db = get_db()
    return bool(
        db["transactions"].find_one(
            {"fromEmail": sender_email, "toEmail": receiver_email}
        )
    )


def _count_outgoing_since(email: str, since: datetime) -> int:
    db = get_db()
    return db["transactions"].count_documents(
        {"fromEmail": email, "createdAt": {"$gte": since}}
    )


def assess_transfer_risk(
    *,
    sender_email: str,
    receiver_email: str,
    amount: float,
    sender_balance: float,
) -> dict:
    reasons = []
    score = 0

    if amount > 1000:
        score += 70
        reasons.append("Transfer amount above 1000")

    has_history = _has_beneficiary_history(sender_email, receiver_email)
    if not has_history:
        score += 25
        reasons.append("First transfer to this beneficiary")

    one_hour_ago = datetime.now(timezone.utc) - ONE_HOUR
    recent_count = _count_outgoing_since(sender_email, one_hour_ago)
    if recent_count >= 5:
        score += 35
        reasons.append("High transfer velocity in last hour")
    elif recent_count >= 3:
        score += 20
        reasons.append("Moderate transfer velocity in last hour")

    remaining_balance = float(sender_balance) - float(amount)
    if remaining_balance < 0:
        score += 100
        reasons.append("Insufficient funds after transfer")
    elif remaining_balance < 250:
        score += 10
        reasons.append("Transfer leaves low remaining balance")

    level = _get_risk_level(score)
    requires_review = level == "HIGH"

    return {
        "score": score,
        "level": level,
        "requiresReview": requires_review,
        "reasons": reasons,
        "checks": {
            "amount": float(amount),
            "recentOutgoingCount": recent_count,
            "hasBeneficiaryHistory": bool(has_history),
            "remainingBalance": remaining_balance,
        },
    }
