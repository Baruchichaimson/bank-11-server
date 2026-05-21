import { END, START, StateGraph } from '@langchain/langgraph';
import { BankingState } from '../../state/bankingState.js';
import { getWindowToolAction, getWindowToolReply } from '../../shared/responseWrappers.js';

const leverageDataNode = async (state, config) => {
  const services = config?.configurable?.services;
  const result = await services.supportService.connectRepresentative({ userId: state.session.userId });

  return {
    ...state,
    workflow: { ...state.workflow, currentPhase: 'Leverage Data' },
    support: {
      ...state.support,
      ticketId: result?.ticketId || null
    },
    execution: {
      executed: true,
      result
    },
    ui: { ...state.ui, action: getWindowToolAction('open_video_call_window', result) }
  };
};

const returnResponseNode = async (state) => ({
  ...state,
  workflow: { ...state.workflow, currentPhase: 'Return Response with Suggestions' },
  ui: {
    ...state.ui,
    message: getWindowToolReply('open_video_call_window', state.session.userLanguage)
  }
});

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
