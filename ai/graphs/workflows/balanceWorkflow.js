import { END, START, StateGraph } from '@langchain/langgraph';
import { BankingState } from '../../state/bankingState.js';
import { formatFinancialResponse } from '../../shared/responseFormatting.js';

const evaluateAccountNode = async (state, config) => {
  const services = config?.configurable?.services;
  const result = await services.accountService.getBalance({ userId: state.session.userId });

  return {
    ...state,
    workflow: { ...state.workflow, currentPhase: 'Evaluate Account' },
    balance: {
      ...state.balance,
      currentBalance: result?.balance ?? null,
      accountSummary: result
    },
    execution: {
      executed: true,
      result
    },
    ui: { ...state.ui, message: '' }
  };
};

const returnResponseNode = async (state) => ({
  ...state,
  workflow: { ...state.workflow, currentPhase: 'Return Response with Suggestions' },
  ui: {
    ...state.ui,
    message: formatFinancialResponse('get_balance', state.execution.result, state.session.userLanguage)
  }
});

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
