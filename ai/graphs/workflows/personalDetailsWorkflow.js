import { END, START, StateGraph } from '@langchain/langgraph';
import { BankingState } from '../../state/bankingState.js';
import { formatFinancialResponse } from '../../shared/responseFormatting.js';

const leverageDataNode = async (state, config) => {
  const services = config?.configurable?.services;
  const result = await services.profileService.getUserProfile({ userId: state.session.userId });

  return {
    ...state,
    workflow: { ...state.workflow, activeWorkflow: 'unknown', currentPhase: 'Leverage Data' },
    personalDetails: {
      ...state.personalDetails,
      userProfile: result
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
    message: formatFinancialResponse('get_user_identity', state.execution.result, state.session.userLanguage)
  }
});

const personalDetailsWorkflowGraph = new StateGraph(BankingState)
  .addNode('leverage_data', leverageDataNode)
  .addNode('return_response_with_suggestions', returnResponseNode)
  .addEdge(START, 'leverage_data')
  .addEdge('leverage_data', 'return_response_with_suggestions')
  .addEdge('return_response_with_suggestions', END)
  .compile();

export const runPersonalDetailsWorkflow = async ({ state, services }) => (
  personalDetailsWorkflowGraph.invoke(state, { configurable: { services } })
);
