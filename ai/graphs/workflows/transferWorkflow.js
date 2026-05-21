import { runTransferGraph } from '../../transferGraph.js';
import { getWindowToolAction, getWindowToolReply } from '../../shared/responseWrappers.js';

export const runTransferWorkflow = async ({ state, services }) => {
  const result = await runTransferGraph({
    userInput: state.userInput,
    userLanguage: state.session.userLanguage,
    userId: state.session.userId,
    transferState: state.transfer.nextTransferState,
    services
  });
  const nextTransferState = result.nextTransferState || state.transfer.nextTransferState;

  if (!result.handled) {
    const formResult = await services.transactionService.openTransferForm({ userId: state.session.userId });
    return {
      ...state,
      workflow: { ...state.workflow, currentPhase: 'Return Response with Suggestions' },
      execution: {
        executed: true,
        result: formResult
      },
      ui: {
        ...state.ui,
        message: getWindowToolReply('open_money_transfer_window', state.session.userLanguage),
        action: getWindowToolAction('open_money_transfer_window', formResult)
      }
    };
  }

  return {
    ...state,
    workflow: { ...state.workflow, currentPhase: 'Return Response with Suggestions' },
    transfer: {
      ...state.transfer,
      receiverEmail: nextTransferState?.receiverEmail || '',
      amount: nextTransferState?.amount ?? null,
      description: nextTransferState?.description || '',
      confirmationRequired: Boolean(nextTransferState?.riskConfirmationAsked),
      phase: nextTransferState?.phase || 'idle',
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
