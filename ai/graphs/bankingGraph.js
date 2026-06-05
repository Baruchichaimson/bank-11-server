import { END, START, StateGraph } from '@langchain/langgraph';
import { BankingState, createInitialBankingState } from '../state/bankingState.js';
import { detectIntent } from '../intents/before-llm/detectIntent.js';
import { routeWorkflow } from '../router/workflowRouter.js';
import { runTransferWorkflow } from './workflows/transferWorkflow.js';
import { runTransactionsWorkflow } from './workflows/transactionsWorkflow.js';
import { runBalanceWorkflow } from './workflows/balanceWorkflow.js';
import { runSupportWorkflow } from './workflows/supportWorkflow.js';
import { runPersonalDetailsWorkflow } from './workflows/personalDetailsWorkflow.js';
import { runUnknownWorkflow } from './workflows/unknownWorkflow.js';
import { createReplyPayload, detectLanguage } from '../shared/shared.js';

const isActiveTransferState = (transferState = null) => {
  const phase = transferState?.phase;
  return Boolean(phase && phase !== 'idle');
};

const hasMeaningfulTransferPayload = (payload = null) => Boolean(
  payload
    && (
      payload.receiverEmail
      || payload.amount
      || payload.description
      || payload.confirmation
      || payload.skipDescription
      || payload.startNewTransfer
    )
);

const userRequestNode = async (state) => ({
  ...state,
  workflow: { ...state.workflow, currentPhase: 'User Request' },
  audit: {
    ...state.audit,
    transitions: [...(state.audit?.transitions || []), 'User Request']
  }
});

const findIntentNode = async (state, config) => {
  const transferPayload = state.intent?.transferPayload || null;
  if (
    isActiveTransferState(state.transfer?.nextTransferState)
    || hasMeaningfulTransferPayload(transferPayload)
  ) {
    return {
      ...state,
      intent: {
        ...state.intent,
        detectedIntent: 'transfer_money',
        confidence: 1,
        domain: 'transactions',
        source: 'transfer_workflow_state',
        workflowContinuation: true,
        semanticQuery: null,
        correction: null,
        transferPayload,
        toolName: null,
        toolArgs: {},
        isAmbiguous: false,
        ambiguityReason: null
      },
      audit: {
        ...state.audit,
        transitions: [...(state.audit?.transitions || []), 'Intent: transfer_money']
      }
    };
  }

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

const getServices = (config) => config?.configurable?.services;
const getCreateChatCompletion = (config) => config?.configurable?.createChatCompletion;
const getAbortSignal = (config) => config?.configurable?.abortSignal;

const runTransferWorkflowNode = (state, config) => runTransferWorkflow({
  state,
  services: getServices(config),
  createChatCompletion: getCreateChatCompletion(config),
  abortSignal: getAbortSignal(config)
});

const runTransactionsWorkflowNode = (state, config) => runTransactionsWorkflow({
  state,
  services: getServices(config)
});

const runBalanceWorkflowNode = (state, config) => runBalanceWorkflow({
  state,
  services: getServices(config)
});

const runSupportWorkflowNode = (state, config) => runSupportWorkflow({
  state,
  services: getServices(config)
});

const runPersonalDetailsWorkflowNode = (state, config) => runPersonalDetailsWorkflow({
  state,
  services: getServices(config)
});

const runUnknownWorkflowNode = (state) => runUnknownWorkflow({ state });

const returnResponseNode = async (state) => {
  return {
    ...state,
    workflow: { ...state.workflow, currentPhase: 'Return Response' }
  };
};

export const createBankingGraph = () => {
  const graph = new StateGraph(BankingState)
    .addNode('user_request', userRequestNode)
    .addNode('find_intent', findIntentNode)
    .addNode('workflow_router', workflowRouterNode)
    .addNode('transfer_workflow', runTransferWorkflowNode)
    .addNode('transactions_workflow', runTransactionsWorkflowNode)
    .addNode('balance_workflow', runBalanceWorkflowNode)
    .addNode('support_workflow', runSupportWorkflowNode)
    .addNode('personal_details_workflow', runPersonalDetailsWorkflowNode)
    .addNode('unknown_workflow', runUnknownWorkflowNode)
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

export const bankingGraph = createBankingGraph();

export const runBankingGraph = async ({
  userInput,
  userId,
  userEmail = null,
  history = [],
  transferState = null,
  transferPayload = null,
  createChatCompletion,
  services,
  abortSignal
}) => {
  const userLanguage = detectLanguage(userInput);
  const finalState = await bankingGraph.invoke(
    createInitialBankingState({
      userInput,
      history,
      userId,
      userEmail,
      userLanguage,
      transferState,
      transferPayload
    }),
    {
      configurable: {
        createChatCompletion,
        services,
        abortSignal
      }
    }
  );

  return createReplyPayload({
    history: finalState.history,
    userText: finalState.userInput,
    reply: finalState.ui?.message || '',
    transferState: finalState.transfer?.nextTransferState || null,
    action: finalState.ui?.action || null
  });
};
