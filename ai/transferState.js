import { Annotation } from '@langchain/langgraph';

export const TRANSFER_PHASE = {
  IDLE: 'idle',
  COLLECT_RECEIVER: 'collect_receiver',
  COLLECT_AMOUNT: 'collect_amount',
  COLLECT_DESCRIPTION: 'collect_description',
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
  riskConfirmationAsked: Annotation(),
  transferIntent: Annotation(),
  detectedIntent: Annotation()
});

export const resetTransferFlow = {
  phase: TRANSFER_PHASE.IDLE,
  receiverEmail: '',
  amount: null,
  description: '',
  riskConfirmationAsked: false,
  flowLanguage: ''
};

export const buildTransferGraphInitialState = ({
  userInput,
  userLanguage,
  userId,
  transferState
}) => ({
  userInput,
  userLanguage,
  flowLanguage: transferState?.flowLanguage || (userLanguage === 'he' ? 'he' : 'en'),
  userId,
  phase: transferState?.phase || TRANSFER_PHASE.IDLE,
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
  riskConfirmationAsked: transferState?.riskConfirmationAsked || false,
  transferIntent: false,
  detectedIntent: 'unknown'
});

export const buildNextTransferState = (result) => ({
  phase: result?.phase || TRANSFER_PHASE.IDLE,
  receiverEmail: result?.receiverEmail || '',
  amount: result?.amount ?? null,
  description: result?.description || '',
  riskConfirmationAsked: Boolean(result?.riskConfirmationAsked),
  flowLanguage: result?.flowLanguage || ''
});
