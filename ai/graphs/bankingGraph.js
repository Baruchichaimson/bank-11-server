import { END, START, StateGraph } from '@langchain/langgraph';
import { BankingState } from '../state/bankingState.js';
import { detectIntent } from '../intents/before-llm/detectIntent.js';
import { routeWorkflow } from '../router/workflowRouter.js';
import { runTransferWorkflow } from './workflows/transferWorkflow.js';
import { runTransactionsWorkflow } from './workflows/transactionsWorkflow.js';
import { runBalanceWorkflow } from './workflows/balanceWorkflow.js';
import { runSupportWorkflow } from './workflows/supportWorkflow.js';
import { runPersonalDetailsWorkflow } from './workflows/personalDetailsWorkflow.js';
import { runUnknownWorkflow } from './workflows/unknownWorkflow.js';
import { createReplyPayload, detectLanguage } from '../shared/shared.js';

const userRequestNode = async (state) => ({
  ...state,
  workflow: { ...state.workflow, currentPhase: 'User Request' },
  audit: {
    ...state.audit,
    transitions: [...(state.audit?.transitions || []), 'User Request']
  }
});

const findIntentNode = async (state, config) => {
  const detection = await detectIntent({
    userInput: state.userInput,
    history: state.history,
    createChatCompletion: config?.configurable?.createChatCompletion,
    abortSignal: config?.configurable?.abortSignal
  });

  return {
    ...state,
    intent: {
      detectedIntent: detection.intent,
      confidence: detection.confidence,
      domain: detection.domain,
      source: detection.source,
      workflowContinuation: detection.workflowContinuation,
      semanticQuery: detection.semanticQuery,
      correction: detection.correction,
      transferPayload: detection.transferPayload,
      toolName: detection.toolName,
      toolArgs: detection.toolArgs,
      isAmbiguous: detection.isAmbiguous,
      ambiguityReason: detection.ambiguityReason
    },
    audit: {
      ...state.audit,
      transitions: [...(state.audit?.transitions || []), `Intent: ${detection.intent}`]
    }
  };
};

const workflowRouterNode = async (state) => {
  const workflow = routeWorkflow({
    intent: state.intent.detectedIntent,
    domain: state.intent.domain
  });

  return {
    ...state,
    workflow: {
      ...state.workflow,
      activeWorkflow: workflow,
      currentPhase: 'Workflow Routing'
    },
    audit: {
      ...state.audit,
      transitions: [...(state.audit?.transitions || []), `Workflow: ${workflow}`]
    }
  };
};

const returnResponseNode = async (state) => {
  const userLanguage = detectLanguage(state.userInput);
  return createReplyPayload({
    ...state,
    userLanguage,
    response: state.response
  });
};

export const createBankingGraph = () => {
  const graph = new StateGraph(BankingState)
    .addNode('user_request', userRequestNode)
    .addNode('find_intent', findIntentNode)
    .addNode('workflow_router', workflowRouterNode)
    .addNode('transfer_workflow', runTransferWorkflow)
    .addNode('transactions_workflow', runTransactionsWorkflow)
    .addNode('balance_workflow', runBalanceWorkflow)
    .addNode('support_workflow', runSupportWorkflow)
    .addNode('personal_details_workflow', runPersonalDetailsWorkflow)
    .addNode('unknown_workflow', runUnknownWorkflow)
    .addNode('return_response', returnResponseNode)
    .addEdge(START, 'user_request')
    .addEdge('user_request', 'find_intent')
    .addEdge('find_intent', 'workflow_router')
    .addConditionalEdges('workflow_router', (state) => state.workflow.activeWorkflow, {
      transfer_workflow: 'transfer_workflow',
      transactions_workflow: 'transactions_workflow',
      balance_workflow: 'balance_workflow',
      support_workflow: 'support_workflow',
      personal_details_workflow: 'personal_details_workflow',
      unknown_workflow: 'unknown_workflow'
    })
    .addEdge('transfer_workflow', 'return_response')
    .addEdge('transactions_workflow', 'return_response')
    .addEdge('balance_workflow', 'return_response')
    .addEdge('support_workflow', 'return_response')
    .addEdge('personal_details_workflow', 'return_response')
    .addEdge('unknown_workflow', 'return_response')
    .addEdge('return_response', END);

  return graph.compile();
};

export const runBankingGraph = createBankingGraph();
