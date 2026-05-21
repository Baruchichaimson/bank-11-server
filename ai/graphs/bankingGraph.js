import { END, START, StateGraph } from '@langchain/langgraph';
import { BankingState, createInitialBankingState } from '../state/bankingState.js';
import { detectIntent } from '../intents/detectIntent.js';
import { isTransferControlMessage } from '../intents/queryParser.js';
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
  if (
    state.transfer.nextTransferState?.phase
    && state.transfer.nextTransferState.phase !== 'idle'
    && isTransferControlMessage(state.userInput)
  ) {
    const detection = { intent: 'transfer_money', confidence: 1, domain: 'transactions', source: 'current_message_transfer_control' };
    return {
      ...state,
      workflow: { ...state.workflow, currentPhase: 'Find Intent' },
      intent: {
        detectedIntent: detection.intent,
        confidence: detection.confidence,
        domain: detection.domain,
        semanticQuery: null,
        source: detection.source
      },
      isolation: {
        ...state.isolation,
        routing: {
          ...state.isolation?.routing,
          intentSource: detection.source,
          domain: detection.domain,
          intent: detection.intent
        }
      },
      audit: {
        ...state.audit,
        aiDecisions: [...(state.audit?.aiDecisions || []), detection],
        transitions: [...(state.audit?.transitions || []), 'Find Intent']
      }
    };
  }

  const detection = await detectIntent({
    userInput: state.userInput,
    createChatCompletion: config?.configurable?.createChatCompletion,
    abortSignal: config?.configurable?.abortSignal
  });

  return {
    ...state,
    workflow: { ...state.workflow, currentPhase: 'Find Intent' },
    intent: {
      detectedIntent: detection.intent,
      confidence: detection.confidence,
      domain: detection.domain || 'unknown',
      semanticQuery: detection.semanticQuery || null,
      source: detection.source || 'current_message_only'
    },
    isolation: {
      ...state.isolation,
      routing: {
        ...state.isolation?.routing,
        intentSource: detection.source || 'current_message_only',
        domain: detection.domain || 'unknown',
        intent: detection.intent
      }
    },
    audit: {
      ...state.audit,
      aiDecisions: [...(state.audit?.aiDecisions || []), detection],
      transitions: [...(state.audit?.transitions || []), 'Find Intent']
    }
  };
};

const workflowRouterNode = async (state) => {
  const activeWorkflow = routeWorkflow({
    intent: state.intent.detectedIntent,
    domain: state.intent.domain || 'unknown'
  });
  return {
    ...state,
    workflow: {
      ...state.workflow,
      activeWorkflow,
      currentPhase: 'Workflow Router'
    },
    audit: {
      ...state.audit,
      transitions: [...(state.audit?.transitions || []), 'Workflow Router']
    }
  };
};

const selectWorkflow = (state) => state.workflow.activeWorkflow || 'unknown_workflow';

const returnResponseNode = async (state) => ({
  ...state,
  workflow: { ...state.workflow, currentPhase: 'Return Response with Suggestions' }
});

const graph = new StateGraph(BankingState)
  .addNode('user_request', userRequestNode)
  .addNode('find_intent', findIntentNode)
  .addNode('workflow_router', workflowRouterNode)
  .addNode('transfer_workflow', (state, config) => runTransferWorkflow({ state, services: config?.configurable?.services }))
  .addNode('transactions_workflow', (state, config) => runTransactionsWorkflow({ state, services: config?.configurable?.services }))
  .addNode('balance_workflow', (state, config) => runBalanceWorkflow({ state, services: config?.configurable?.services }))
  .addNode('support_workflow', (state, config) => runSupportWorkflow({ state, services: config?.configurable?.services }))
  .addNode('personal_details_workflow', (state, config) => runPersonalDetailsWorkflow({ state, services: config?.configurable?.services }))
  .addNode('unknown_workflow', (state) => runUnknownWorkflow({ state }))
  .addNode('return_response', returnResponseNode)
  .addEdge(START, 'user_request')
  .addEdge('user_request', 'find_intent')
  .addEdge('find_intent', 'workflow_router')
  .addConditionalEdges('workflow_router', selectWorkflow)
  .addEdge('transfer_workflow', 'return_response')
  .addEdge('transactions_workflow', 'return_response')
  .addEdge('balance_workflow', 'return_response')
  .addEdge('support_workflow', 'return_response')
  .addEdge('personal_details_workflow', 'return_response')
  .addEdge('unknown_workflow', 'return_response')
  .addEdge('return_response', END)
  .compile();

export const runBankingGraph = async ({
  userInput,
  userId,
  history = [],
  transferState = null,
  createChatCompletion,
  services,
  abortSignal
}) => {
  const userLanguage = detectLanguage(userInput);
  const initialState = createInitialBankingState({
    userInput: String(userInput || '').trim(),
    history,
    userId,
    userLanguage,
    transferState
  });

  const result = await graph.invoke(initialState, {
    configurable: {
      createChatCompletion,
      services,
      abortSignal
    }
  });

  return createReplyPayload({
    history,
    userText: userInput,
    reply: String(result?.ui?.message || ''),
    transferState: result?.transfer?.nextTransferState || transferState,
    action: result?.ui?.action || null
  });
};
