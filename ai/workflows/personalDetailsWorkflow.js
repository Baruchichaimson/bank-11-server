import { END, START, StateGraph } from '@langchain/langgraph';
import { BankingState } from '../graph/state/bankingState.js';
import { formatFinancialResponse } from '../assistant/responseFormatting.js';
import {
  createExecutedWorkflowResponse,
  createWorkflowResponse
} from '../contracts/assistantResponseContract.js';

const leverageDataNode = async (state, config) => {
  const services = config?.configurable?.services;
  const result = await services.profileService.getUserProfile({ userId: state.session.userId });
  const workflowResponse = createExecutedWorkflowResponse({
    operation: 'get_user_identity',
    result
  });

  return {
    ...state,
    workflow: { ...state.workflow, activeWorkflow: 'unknown', currentPhase: 'Leverage Data' },
    personalDetails: {
      ...state.personalDetails,
      userProfile: result
    },
    execution: workflowResponse.execution,
    workflowResponse,
    ui: { ...state.ui, message: '' }
  };
};

const returnResponseNode = async (state) => {
  const workflowResponse = createWorkflowResponse({
    ...state.workflowResponse,
    message: formatFinancialResponse('get_user_identity', state.execution.result, state.session.userLanguage)
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
