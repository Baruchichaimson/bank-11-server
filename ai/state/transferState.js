export const createTransferState = (transferState = null) => ({
  receiverEmail: transferState?.receiverEmail || '',
  amount: transferState?.amount ?? null,
  description: transferState?.description || '',
  confirmationRequired: Boolean(transferState?.riskConfirmationAsked),
  phase: transferState?.phase || 'idle',
  nextTransferState: transferState
});
