import { END, START, StateGraph } from '@langchain/langgraph';
import { BankingState, createInitialBankingState } from './state/bankingState.js';
import { detectIntent } from '../intents/before-llm/detectIntent.js';
import { routeWorkflow } from './workflowRouter.js';
import { runTransferWorkflow } from '../workflows/transferWorkflow.js';
import { runTransactionsWorkflow } from '../workflows/transactionsWorkflow.js';
import { runBalanceWorkflow } from '../workflows/balanceWorkflow.js';
import { runSupportWorkflow } from '../workflows/supportWorkflow.js';
import { runPersonalDetailsWorkflow } from '../workflows/personalDetailsWorkflow.js';
import { runUnknownWorkflow } from '../workflows/unknownWorkflow.js';
import { createReplyPayload, detectLanguage } from '../assistant/shared.js';
import { normalizeWorkflowResponse } from '../contracts/assistantResponseContract.js';
import { createIntentResult } from '../contracts/intentResultContract.js';

const BANKING_GRAPH_DEBUG = process.env.BANKING_GRAPH_DEBUG === 'true';

const debugBankingGraph = (...args) => {
  if (BANKING_GRAPH_DEBUG) {
    console.log(...args);
  }
};

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

const toGraphIntentState = (intentResult) => ({
  ...intentResult,
  detectedIntent: intentResult.intent
});

const findIntentNode = async (state, config) => {
  const transferPayload = state.intent?.transferPayload || null;
  if (
    isActiveTransferState(state.transfer?.nextTransferState)
    || hasMeaningfulTransferPayload(transferPayload)
  ) {
    const intentResult = createIntentResult({
      domain: 'transactions',
      intent: 'transfer_money',
      confidence: 1,
      source: 'transfer_workflow_state',
      workflowContinuation: { active: true },
      transferPayload
    });
    debugBankingGraph('BANKING GRAPH DETECTED INTENT', {
      domain: intentResult.domain,
      intent: intentResult.intent,
      source: intentResult.source,
      confidence: intentResult.confidence,
      hasTransferPayload: Boolean(intentResult.transferPayload)
    });

    return {
      ...state,
      intent: toGraphIntentState(intentResult),
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
  debugBankingGraph('BANKING GRAPH DETECTED INTENT', {
    domain: detection.domain,
    intent: detection.intent,
    source: detection.source,
    confidence: detection.confidence,
    hasSemanticQuery: Boolean(detection.semanticQuery),
    hasTransferPayload: Boolean(detection.transferPayload)
  });

  return {
    ...state,
    intent: toGraphIntentState(detection),
    audit: {
      ...state.audit,
      transitions: [...(state.audit?.transitions || []), `Intent: ${detection.intent}`]
    }
  };
};

const workflowRouterNode = async (state) => {
  const workflow = routeWorkflow({
    intent: state.intent.intent || state.intent.detectedIntent,
    domain: state.intent.domain
  });
  debugBankingGraph('BANKING GRAPH SELECTED WORKFLOW', {
    intent: state.intent.intent || state.intent.detectedIntent,
    domain: state.intent.domain,
    workflow
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

const toClientAction = (action) => {
  if (!action) return null;

  if (action.type === 'open_video_call' && !action.payload) {
    return 'open_video_call';
  }

  return action.payload
    ? { type: action.type, ...action.payload }
    : { type: action.type };
};

const returnResponseNode = async (state) => {
  const workflowResponse = normalizeWorkflowResponse(state.workflowResponse || state);
  debugBankingGraph('BANKING GRAPH WORKFLOW RESPONSE', {
    actionType: workflowResponse.action?.type || null,
    hasNextConversationState: Boolean(workflowResponse.nextConversationState),
    executed: Boolean(workflowResponse.execution?.executed),
    operation: workflowResponse.execution?.operation || null
  });

  return {
    ...state,
    workflow: { ...state.workflow, currentPhase: 'Return Response' },
    workflowResponse
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
  const workflowResponse = normalizeWorkflowResponse(finalState.workflowResponse || finalState);

  const replyPayload = createReplyPayload({
    history: finalState.history,
    userText: finalState.userInput,
    reply: workflowResponse.message,
    transferState: workflowResponse.nextConversationState || finalState.transfer?.nextTransferState || null,
    action: toClientAction(workflowResponse.action)
  });
  debugBankingGraph('BANKING GRAPH FINAL REPLY PAYLOAD', {
    hasReply: Boolean(replyPayload.reply),
    actionType: typeof replyPayload.action === 'string'
      ? replyPayload.action
      : replyPayload.action?.type || null,
    hasNextTransferState: Boolean(replyPayload.nextTransferState)
  });

  return replyPayload;
};
