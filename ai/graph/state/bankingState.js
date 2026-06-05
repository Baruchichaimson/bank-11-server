import { Annotation } from '@langchain/langgraph';
import { createBalanceState } from './balanceState.js';
import { createIsolatedTurnState } from './isolatedConversationState.js';
import { createPersonalDetailsState } from './personalDetailsState.js';
import { createSupportState } from './supportState.js';
import { createTransactionsState } from './transactionsState.js';
import { createTransferState } from './transferState.js';
import { createEmptyWorkflowResponse } from '../../contracts/assistantResponseContract.js';
import { createUnknownIntent } from '../../contracts/intentResultContract.js';

export const BankingState = Annotation.Root({
  userInput: Annotation(),
  history: Annotation(),
  userId: Annotation(),

  session: Annotation(),
  isolation: Annotation(),
  intent: Annotation(),
  workflow: Annotation(),
  transfer: Annotation(),
  transactions: Annotation(),
  balance: Annotation(),
  support: Annotation(),
  personalDetails: Annotation(),
  risk: Annotation(),
  execution: Annotation(),
  workflowResponse: Annotation(),
  ui: Annotation(),
  audit: Annotation()
});

export const createInitialBankingState = ({
  userInput,
  history = [],
  userId,
  userEmail = null,
  userLanguage = 'en',
  transferState = null,
  transferPayload = null
}) => ({
  userInput,
  history,
  userId,
  session: {
    userId,
    userEmail,
    userLanguage,
    flowLanguage: transferState?.flowLanguage || userLanguage
  },
  isolation: createIsolatedTurnState({ userInput, userId, userLanguage }),
  intent: {
    ...createUnknownIntent(),
    detectedIntent: 'unknown',
    transferPayload
  },
  workflow: {
    activeWorkflow: 'unknown',
    currentPhase: 'User Request',
    cancelled: false
  },
  transfer: createTransferState(transferState),
  transactions: createTransactionsState(),
  balance: createBalanceState(),
  support: createSupportState(),
  personalDetails: createPersonalDetailsState(),
  risk: {
    level: null,
    triggeredRules: [],
    requiresApproval: false
  },
  execution: {
    executed: false,
    operation: null,
    result: null
  },
  workflowResponse: createEmptyWorkflowResponse(),
  ui: {
    message: '',
    form: null,
    suggestions: [],
    action: null
  },
  audit: {
    transitions: [],
    aiDecisions: []
  }
});
