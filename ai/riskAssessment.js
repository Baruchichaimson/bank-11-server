import { Transaction } from '../entities/transactions.js';

const HIGH_RISK_THRESHOLD = 70;
const MEDIUM_RISK_THRESHOLD = 40;

const ONE_HOUR_MS = 60 * 60 * 1000;

const getRiskLevel = (score) => {
  if (score >= HIGH_RISK_THRESHOLD) return 'HIGH';
  if (score >= MEDIUM_RISK_THRESHOLD) return 'MEDIUM';
  return 'LOW';
};

export const assessTransferRisk = async ({
  senderEmail,
  receiverEmail,
  amount,
  senderBalance
}) => {
  const reasons = [];
  let score = 0;

  if (amount >= 20000) {
    score += 70;
    reasons.push('Very high transfer amount');
  } else if (amount >= 10000) {
    score += 45;
    reasons.push('High transfer amount');
  } else if (amount >= 5000) {
    score += 25;
    reasons.push('Elevated transfer amount');
  }

  const hasBeneficiaryHistory = await Transaction.exists({
    fromEmail: senderEmail,
    toEmail: receiverEmail
  });
  if (!hasBeneficiaryHistory) {
    score += 25;
    reasons.push('First transfer to this beneficiary');
  }

  const oneHourAgo = new Date(Date.now() - ONE_HOUR_MS);
  const recentOutgoingCount = await Transaction.countDocuments({
    fromEmail: senderEmail,
    createdAt: { $gte: oneHourAgo }
  });
  if (recentOutgoingCount >= 5) {
    score += 35;
    reasons.push('High transfer velocity in last hour');
  } else if (recentOutgoingCount >= 3) {
    score += 20;
    reasons.push('Moderate transfer velocity in last hour');
  }

  const remainingBalance = Number(senderBalance) - Number(amount);
  if (remainingBalance < 0) {
    score += 100;
    reasons.push('Insufficient funds after transfer');
  } else if (remainingBalance < 250) {
    score += 10;
    reasons.push('Transfer leaves low remaining balance');
  }

  const level = getRiskLevel(score);
  const requiresReview = level === 'HIGH';

  return {
    score,
    level,
    requiresReview,
    reasons,
    checks: {
      amount: Number(amount),
      recentOutgoingCount,
      hasBeneficiaryHistory: Boolean(hasBeneficiaryHistory),
      remainingBalance
    }
  };
};

