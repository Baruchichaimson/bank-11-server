import { runTransferGraph } from '../../transferGraph.js';
import { getWindowToolAction, getWindowToolReply } from '../../shared/responseWrappers.js';

export const runTransferWorkflow = async ({ state, services, createChatCompletion, abortSignal }) => {
  const result = await runTransferGraph({
    userInput: state.userInput,
    userLanguage: state.session.userLanguage,
    userId: state.session.userId,
    transferState: state.transfer.nextTransferState,
    semanticIntent: state.intent?.detectedIntent,
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
    return {
      ...state,
      workflow: { ...state.workflow, activeWorkflow, currentPhase: 'Return Response with Suggestions' },
      execution: {
        executed: true,
        result: formResult
      },
      ui: {
        ...state.ui,
        message: getWindowToolReply('open_money_transfer_inline', state.session.userLanguage),
        action: getWindowToolAction('open_money_transfer_inline', formResult)
      }
    };
  }

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
    execution: {
      executed: Boolean(result.handled),
      result
    },
    ui: {
      ...state.ui,
      message: result.reply || '',
      action: result.action || null
    }
  };
};
