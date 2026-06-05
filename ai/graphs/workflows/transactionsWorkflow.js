import { END, START, StateGraph } from '@langchain/langgraph';
import { BankingState } from '../../state/bankingState.js';
import { formatFinancialResponse } from '../../shared/responseFormatting.js';
import { getLlmParseFailedReply } from '../../shared/shared.js';
import {
  createEmptyWorkflowResponse,
  createExecutedWorkflowResponse
} from '../../contracts/assistantResponseContract.js';

const leverageDataNode = async (state, config) => {
  const services = config?.configurable?.services;
  const semanticQuery = state.intent?.semanticQuery;

  if (!semanticQuery) {
    const workflowResponse = createEmptyWorkflowResponse({
      message: getLlmParseFailedReply(state.session.userLanguage)
    });

    return {
      ...state,
      workflow: { ...state.workflow, activeWorkflow: 'unknown', currentPhase: 'Return Response with Suggestions' },
      execution: workflowResponse.execution,
      workflowResponse,
      ui: {
        ...state.ui,
        message: workflowResponse.message,
        suggestions: []
      }
    };
  }

  const { operation, result } = await services.transactionService.executeStructuredQuery({
    userId: state.session.userId,
    userEmail: state.session.userEmail,
    query: semanticQuery
  });
  const workflowResponse = createExecutedWorkflowResponse({
    message: formatFinancialResponse(operation, result, state.session.userLanguage),
    operation,
    result
  });

  return {
    ...state,
    workflow: { ...state.workflow, activeWorkflow: 'unknown', currentPhase: 'Return Response with Suggestions' },
    transactions: {
      ...state.transactions,
      filters: semanticQuery.filters,
      dateRange: semanticQuery.dateRange || null,
      transactionType: semanticQuery.action
    },
    execution: workflowResponse.execution,
    workflowResponse,
    ui: {
      ...state.ui,
      message: workflowResponse.message,
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
