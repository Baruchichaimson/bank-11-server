export const EXTRA_CONFIRMATION_THRESHOLD = 1000;

export const RISK_RULES_AND_LIMITS = {
  extraConfirmationThreshold: EXTRA_CONFIRMATION_THRESHOLD,
  maxSingleTransferAmount: 20000,
  lowRemainingBalanceThreshold: 250,
  velocityWindowMinutes: 60,
  velocityModerateCount: 3,
  velocityHighCount: 5
};

export const requiresHighAmountConfirmation = ({
  amount,
  riskConfirmationAsked = false
}) => Number(amount) > EXTRA_CONFIRMATION_THRESHOLD && !riskConfirmationAsked;

export const evaluateTransferRisk = async ({
  services,
  senderUser,
  receiverUser,
  amount,
  senderAccount
}) => {
  const riskPayload = {
    senderEmail: String(senderUser?.email || '').toLowerCase(),
    receiverEmail: String(receiverUser?.email || '').toLowerCase(),
    amount: Number(amount),
    senderBalance: senderAccount?.balance
  };

  if (!services?.riskService?.evaluateRisk) {
    return { requiresReview: false, score: 0, level: 'LOW', reasons: [] };
  }

  return services.riskService.evaluateRisk(riskPayload);
};
