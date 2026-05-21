import { END, START, StateGraph } from '@langchain/langgraph';
import { BankingState } from '../../state/bankingState.js';
import {
  extractFoundTransfersCountFromAssistant,
  extractRequestedCountFromComplaint,
  getLastAssistantMessage,
  inferFollowupToolFromHistory,
  inferHighConfidenceTool,
  inferToolFromUserInput
} from '../../shared/legacyCompatUtils.js';
import { formatFinancialResponse } from '../../shared/responseFormatting.js';

const TRANSACTION_SERVICE_CALLS = {
  get_recent_transfers: (service, userId, args) => service.getTransactions({ userId, args }),
  get_last_transfer: (service, userId) => service.getLastTransfer({ userId }),
  count_transfers: (service, userId, args) => service.countTransfers({ userId, args }),
  get_last_sent_transfer_to_recipient: (service, userId, args) => service.getTransfersWithCounterparty({ userId, args })
};

const leverageDataNode = async (state, config) => {
  const services = config?.configurable?.services;
  const history = state.history || [];
  const followup = inferFollowupToolFromHistory(state.userInput, history);

  if (followup?.name === '__complaint_requested_count__') {
    const requested = extractRequestedCountFromComplaint(state.userInput);
    const found = extractFoundTransfersCountFromAssistant(getLastAssistantMessage(history));
    const message = state.session.userLanguage === 'he'
      ? (requested && found !== null && found < requested
        ? `בטווח הזמן שביקשת נמצאו רק ${found} העברות, לכן אין לי ${requested} להציג. אפשר להרחיב טווח זמן ואביא יותר.`
        : 'אם לא הוחזרו מספיק תוצאות, כנראה שאין מספיק העברות בטווח הזמן שנבחר. אפשר להרחיב טווח זמן.')
      : (requested && found !== null && found < requested
        ? `Only ${found} transfers were found in that range, so I cannot show ${requested}. You can widen the time range and I will fetch more.`
        : 'If fewer results were returned, there may not be enough transfers in that date range. You can widen the range.');

    return {
      ...state,
      workflow: { ...state.workflow, currentPhase: 'Return Response with Suggestions' },
      execution: { executed: false, result: null },
      ui: { ...state.ui, message }
    };
  }

  const inferred = followup || inferHighConfidenceTool(state.userInput) || inferToolFromUserInput(state.userInput);
  const toolName = TRANSACTION_SERVICE_CALLS[inferred?.name] ? inferred.name : 'get_recent_transfers';
  const args = inferred?.args || { limit: 5 };
  const callService = TRANSACTION_SERVICE_CALLS[toolName];
  const result = await callService(services.transactionService, state.session.userId, args);

  return {
    ...state,
    workflow: { ...state.workflow, currentPhase: 'Return Response with Suggestions' },
    transactions: {
      ...state.transactions,
      filters: args,
      transactionType: toolName
    },
    execution: {
      executed: true,
      result
    },
    ui: {
      ...state.ui,
      message: formatFinancialResponse(toolName, result, state.session.userLanguage),
      suggestions: []
    }
  };
};

const returnResponseNode = async (state) => ({
  ...state,
  workflow: { ...state.workflow, currentPhase: 'Return Response with Suggestions' }
});

const transactionsWorkflowGraph = new StateGraph(BankingState)
  .addNode('leverage_data', leverageDataNode)
  .addNode('return_response_with_suggestions', returnResponseNode)
  .addEdge(START, 'leverage_data')
  .addEdge('leverage_data', 'return_response_with_suggestions')
  .addEdge('return_response_with_suggestions', END)
  .compile();

export const runTransactionsWorkflow = async ({ state, services }) => (
  transactionsWorkflowGraph.invoke(state, { configurable: { services } })
);
