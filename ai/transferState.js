import { Annotation } from '@langchain/langgraph';

export const TRANSFER_PHASE = {
  IDLE: 'idle',
  FORM_OPEN: 'form_open',
  AWAIT_CONFIRMATION: 'await_confirmation'
};

export const TransferState = Annotation.Root({
  userInput: Annotation(),
  userLanguage: Annotation(),
  flowLanguage: Annotation(),
  userId: Annotation(),
  phase: Annotation(),
  receiverEmail: Annotation(),
  amount: Annotation(),
  description: Annotation(),
  handled: Annotation(),
  reply: Annotation(),
  action: Annotation(),
  riskAssessment: Annotation(),
  senderUser: Annotation(),
  receiverUser: Annotation(),
  senderAccount: Annotation(),
  receiverAccount: Annotation(),
  recentTransactions: Annotation(),
  riskRulesAndLimits: Annotation(),
  shouldRunTransfer: Annotation(),
  transferExecuted: Annotation(),
  transactionResult: Annotation(),
  suggestions: Annotation(),
  errorMessage: Annotation(),
  lastValidationError: Annotation(),
  riskConfirmationAsked: Annotation(),
  transferIntent: Annotation(),
  detectedIntent: Annotation(),
  semanticIntent: Annotation(),
  transferPayload: Annotation(),
  correction: Annotation()
});

export const resetTransferFlow = {
  phase: TRANSFER_PHASE.IDLE,
  receiverEmail: '',
  amount: null,
  description: '',
  riskConfirmationAsked: false,
  flowLanguage: ''
};

const normalizeTransferPhase = (phase) => {
  if (['collect_receiver', 'collect_amount', 'collect_description'].includes(phase)) {
    return TRANSFER_PHASE.FORM_OPEN;
  }

  return Object.values(TRANSFER_PHASE).includes(phase) ? phase : TRANSFER_PHASE.IDLE;
};

export const buildTransferGraphInitialState = ({
  userInput,
  userLanguage,
  userId,
  transferState,
  semanticIntent = 'unknown',
  transferPayload = null,
  correction = null
}) => ({
  userInput,
  userLanguage,
  flowLanguage: transferState?.flowLanguage || (userLanguage === 'he' ? 'he' : 'en'),
  userId,
  phase: normalizeTransferPhase(transferState?.phase),
  receiverEmail: transferState?.receiverEmail || '',
  amount: transferState?.amount ?? null,
  description: transferState?.description || '',
  handled: false,
  reply: '',
  action: null,
  riskAssessment: null,
  senderUser: null,
  receiverUser: null,
  senderAccount: null,
  receiverAccount: null,
  recentTransactions: [],
  riskRulesAndLimits: null,
  shouldRunTransfer: false,
  transferExecuted: false,
  transactionResult: null,
  suggestions: [],
  errorMessage: null,
  lastValidationError: transferState?.lastValidationError || null,
  riskConfirmationAsked: transferState?.riskConfirmationAsked || false,
  transferIntent: false,
  detectedIntent: 'unknown',
  semanticIntent,
  transferPayload,
  correction
});

const buildLastValidationError = (result) => {
  if (result?.action?.type === 'transfer_form_error') {
    return {
      field: result.action.field || 'unknown',
      message: result.action.message || '',
      code: result.errorMessage || null
    };
  }

  if (result?.errorMessage && result?.phase && result.phase !== TRANSFER_PHASE.IDLE) {
    return {
      field: 'unknown',
      message: String(result.errorMessage),
      code: result.errorMessage
    };
  }

  return null;
};

export const buildNextTransferState = (result) => ({
  phase: result?.phase || TRANSFER_PHASE.IDLE,
  receiverEmail: result?.receiverEmail || '',
  amount: result?.amount ?? null,
  description: result?.description || '',
  riskConfirmationAsked: Boolean(result?.riskConfirmationAsked),
  flowLanguage: result?.flowLanguage || '',
  lastValidationError: buildLastValidationError(result)
});
