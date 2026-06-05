import { END, START, StateGraph } from '@langchain/langgraph';
import { BankingState } from '../../state/bankingState.js';
import { formatFinancialResponse } from '../../shared/responseFormatting.js';
import {
  createExecutedWorkflowResponse,
  createWorkflowResponse
} from '../../contracts/assistantResponseContract.js';

const evaluateAccountNode = async (state, config) => {
  const services = config?.configurable?.services;
  const result = await services.accountService.getBalance({ userId: state.session.userId });
  const workflowResponse = createExecutedWorkflowResponse({
    operation: 'get_balance',
    result
  });

  return {
    ...state,
    workflow: { ...state.workflow, activeWorkflow: 'unknown', currentPhase: 'Evaluate Account' },
    balance: {
      ...state.balance,
      currentBalance: result?.balance ?? null,
      accountSummary: result
    },
    execution: workflowResponse.execution,
    workflowResponse,
    ui: { ...state.ui, message: '' }
  };
};

const returnResponseNode = async (state) => {
  const workflowResponse = createWorkflowResponse({
    ...state.workflowResponse,
    message: formatFinancialResponse('get_balance', state.execution.result, state.session.userLanguage)
  });

  return {
    ...state,
    workflow: { ...state.workflow, currentPhase: 'Return Response with Suggestions' },
    workflowResponse,
    ui: {
      ...state.ui,
      message: workflowResponse.message
    }
  };
};

const balanceWorkflowGraph = new StateGraph(BankingState)
  .addNode('evaluate_account', evaluateAccountNode)
  .addNode('return_response_with_suggestions', returnResponseNode)
  .addEdge(START, 'evaluate_account')
  .addEdge('evaluate_account', 'return_response_with_suggestions')
  .addEdge('return_response_with_suggestions', END)
  .compile();

export const runBalanceWorkflow = async ({ state, services }) => (
  balanceWorkflowGraph.invoke(state, { configurable: { services } })
);
