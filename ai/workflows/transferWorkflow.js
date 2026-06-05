import { runTransferGraph } from './transfer/transferWorkflow.js';
import { getWindowToolAction, getWindowToolReply } from '../assistant/responseWrappers.js';
import {
  createExecutedWorkflowResponse,
  createWorkflowResponse
} from '../contracts/assistantResponseContract.js';

export const runTransferWorkflow = async ({ state, services, createChatCompletion, abortSignal }) => {
  const result = await runTransferGraph({
    userInput: state.userInput,
    userLanguage: state.session.userLanguage,
    userId: state.session.userId,
    transferState: state.transfer.nextTransferState,
    semanticIntent: state.intent?.intent || state.intent?.detectedIntent,
    transferPayload: state.intent?.transferPayload || null,
    correction: state.intent?.correction || null,
    services,
    createChatCompletion,
    abortSignal
  });
  const nextTransferState = result.nextTransferState || state.transfer.nextTransferState;
  const activeWorkflow = nextTransferState?.phase && nextTransferState.phase !== 'idle'
    ? 'transfer_workflow'
    : 'unknown';

  if (!result.handled) {
    const formResult = await services.transactionService.openTransferForm({ userId: state.session.userId });
    const workflowResponse = createExecutedWorkflowResponse({
      message: getWindowToolReply('open_money_transfer_inline', state.session.userLanguage),
      action: getWindowToolAction('open_money_transfer_inline', formResult),
      operation: 'open_money_transfer_inline',
      result: formResult
    });

    return {
      ...state,
      workflow: { ...state.workflow, activeWorkflow, currentPhase: 'Return Response with Suggestions' },
      execution: workflowResponse.execution,
      workflowResponse,
      ui: {
        ...state.ui,
        message: workflowResponse.message,
        action: getWindowToolAction('open_money_transfer_inline', formResult)
      }
    };
  }

  const workflowResponse = createWorkflowResponse({
    message: result.reply || '',
    action: result.action || null,
    nextConversationState: nextTransferState,
    execution: {
      executed: Boolean(result.handled),
      operation: 'transfer_money',
      result
    }
  });

  return {
    ...state,
    workflow: { ...state.workflow, activeWorkflow, currentPhase: 'Return Response with Suggestions' },
    transfer: {
      ...state.transfer,
      receiverEmail: nextTransferState?.receiverEmail || '',
      amount: nextTransferState?.amount ?? null,
      description: nextTransferState?.description || '',
      confirmationRequired: Boolean(nextTransferState?.riskConfirmationAsked),
      phase: nextTransferState?.phase || 'idle',
      lastValidationError: nextTransferState?.lastValidationError || null,
      nextTransferState
    },
    execution: workflowResponse.execution,
    workflowResponse,
    ui: {
      ...state.ui,
      message: workflowResponse.message,
      action: result.action || null
    }
  };
};
