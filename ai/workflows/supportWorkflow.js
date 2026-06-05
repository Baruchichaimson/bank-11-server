import { END, START, StateGraph } from '@langchain/langgraph';
import { BankingState } from '../graph/state/bankingState.js';
import { getWindowToolAction, getWindowToolReply } from '../assistant/responseWrappers.js';
import {
  createExecutedWorkflowResponse,
  createWorkflowResponse
} from '../contracts/assistantResponseContract.js';

const leverageDataNode = async (state, config) => {
  const services = config?.configurable?.services;
  const result = await services.supportService.connectRepresentative({ userId: state.session.userId });
  const workflowResponse = createExecutedWorkflowResponse({
    action: getWindowToolAction('open_video_call_window', result),
    operation: 'open_video_call_window',
    result
  });

  return {
    ...state,
    workflow: { ...state.workflow, activeWorkflow: 'unknown', currentPhase: 'Leverage Data' },
    support: {
      ...state.support,
      ticketId: result?.ticketId || null
    },
    execution: workflowResponse.execution,
    workflowResponse,
    ui: { ...state.ui, action: getWindowToolAction('open_video_call_window', result) }
  };
};

const returnResponseNode = async (state) => {
  const workflowResponse = createWorkflowResponse({
    ...state.workflowResponse,
    message: getWindowToolReply('open_video_call_window', state.session.userLanguage)
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

const supportWorkflowGraph = new StateGraph(BankingState)
  .addNode('leverage_data', leverageDataNode)
  .addNode('return_response_with_suggestions', returnResponseNode)
  .addEdge(START, 'leverage_data')
  .addEdge('leverage_data', 'return_response_with_suggestions')
  .addEdge('return_response_with_suggestions', END)
  .compile();

export const runSupportWorkflow = async ({ state, services }) => (
  supportWorkflowGraph.invoke(state, { configurable: { services } })
);
