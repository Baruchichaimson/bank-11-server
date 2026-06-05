import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent } from '../ai/intents/before-llm/detectIntent.js';
import { buildSemanticParserPrompt, validateLlmSemanticParse } from '../ai/intents/llmSemanticParser.js';
import { SEMANTIC_CATALOG } from '../ai/intents/before-llm/semanticCatalog.js';

const FIXED_PROMPT_DATE = '2026-06-04';

const freezePromptDate = () => {
  mock.timers.enable({
    apis: ['Date'],
    now: new Date(`${FIXED_PROMPT_DATE}T12:00:00.000Z`)
  });
};

afterEach(() => {
  mock.timers.reset();
});

const createLlmMock = (payload) => async () => ({
  choices: [{
    message: {
      content: JSON.stringify({
        workflowContinuation: false,
        correction: null,
        transferPayload: null,
        semanticQuery: null,
        ...payload
      })
    }
  }]
});

test('detectIntent uses LLM as primary semantic parser', async () => {
  freezePromptDate();

  let receivedMessages = [];
  let receivedTemperature = null;
  let receivedTopP = null;
  let receivedResponseFormat = null;
  const createChatCompletion = async ({ messages, temperature, top_p, response_format }) => {
    receivedMessages = messages;
    receivedTemperature = temperature;
    receivedTopP = top_p;
    receivedResponseFormat = response_format;
    return {
      choices: [{
        message: {
          content: JSON.stringify({
            domain: 'transactions',
            intent: 'recent_transactions',
            semanticQuery: {
              domain: 'transactions',
              intent: 'transactions_query',
              action: 'transfer_money',
              filters: { type: 'transfer' },
              timeRange: null,
              dateRange: { from: '2026-06-01', to: '2026-06-04' },
              aggregation: 'list',
              limit: 25
            }
          })
        }
      }]
    };
  };

  const result = await detectIntent({
    userInput: 'תראה לי עשרים וחמש העברות אחרונות החודש',
    history: [
      { role: 'user', content: 'תראה לי שתי העברות אחרונות' },
      { role: 'assistant', content: 'מצאתי עבורך 2 העברות אחרונות...' }
    ],
    createChatCompletion
  });

  assert.equal(receivedMessages.length, 2);
  assert.equal(receivedMessages[1].role, 'user');
  assert.equal(receivedTemperature, 0);
  assert.equal(receivedTopP, 1);
  assert.deepEqual(receivedResponseFormat, { type: 'json_object' });
  const parserInput = JSON.parse(receivedMessages[1].content);
  assert.equal(parserInput.currentUserMessage, 'תראה לי עשרים וחמש העברות אחרונות החודש');
  assert.equal(parserInput.currentDate, FIXED_PROMPT_DATE);
  assert.equal(parserInput.recentConversation.length, 2);
  assert.equal(parserInput.recentConversation[0].content, 'תראה לי שתי העברות אחרונות');
  assert.equal(result.source, 'llm_semantic_parser');
  assert.equal(result.domain, 'transactions');
  assert.equal(result.intent, 'recent_transactions');
  assert.equal(result.semanticQuery.limit, 25);
  assert.equal(result.semanticQuery.timeRange, null);
  assert.deepEqual(result.semanticQuery.dateRange, { from: '2026-06-01', to: '2026-06-04' });
});

test('buildSemanticParserPrompt is driven by semantic intent contract, not phrase signals', () => {
  const prompt = buildSemanticParserPrompt();

  assert.match(prompt, /conversation-aware semantic banking intent classifier/);
  assert.match(prompt, /recent conversation context/);
  assert.match(prompt, /Response contract:/);
  assert.match(prompt, /Semantic intent contract:/);
  assert.match(prompt, /classify by the meaning/i);
  assert.match(prompt, /"chooseWhen"/);
  assert.match(prompt, /"doNotChooseWhen"/);
  assert.doesNotMatch(prompt, /"signals"/);
  assert.doesNotMatch(prompt, /"aliases"/);
  assert.doesNotMatch(prompt, /"toolQueryDefaults"/);
  assert.doesNotMatch(prompt, /Semantic guidance:/);
  assert.doesNotMatch(prompt, /Examples:\s*User:/);
  assert.doesNotMatch(prompt, /"העברה אחרונה" or "latest transfer" uses/);
  assert.equal(
    SEMANTIC_CATALOG.matchingPolicy.doNotSelectBySingleWordOverlap,
    true
  );
});

test('validateLlmSemanticParse normalizes unsupported transaction values without transfer defaults', () => {
  const result = validateLlmSemanticParse({
    domain: 'transactions',
    intent: 'recent_transactions',
    semanticQuery: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'delete_account',
      filters: { type: 'wire' },
      timeRange: 'next_year',
      aggregation: 'list',
      limit: 1000
    }
  });

  assert.deepEqual(result.semanticQuery, {
    domain: 'transactions',
    intent: 'transactions_query',
    action: null,
    filters: { type: null },
    timeRange: null,
    aggregation: 'list',
    limit: null
  });
});

test('validateLlmSemanticParse preserves validated transfer payload', () => {
  const result = validateLlmSemanticParse({
    domain: 'transactions',
    intent: 'transfer_money',
    workflowContinuation: true,
    correction: { field: 'amount', value: '250.5' },
    transferPayload: {
      receiverEmail: 'Receiver@Example.com',
      amount: '250.5',
      description: 'rent',
      confirmation: 'yes',
      skipDescription: false,
      startNewTransfer: false
    }
  });

  assert.equal(result.domain, 'transactions');
  assert.equal(result.intent, 'transfer_money');
  assert.deepEqual(result.transferPayload, {
    receiverEmail: 'receiver@example.com',
    amount: 250.5,
    description: 'rent',
    confirmation: 'yes',
    skipDescription: false,
    startNewTransfer: false
  });
});

test('validateLlmSemanticParse maps legacy tool names to canonical domains and intents', () => {
  const result = validateLlmSemanticParse({
    domain: 'unknown',
    intent: 'get_balance',
    toolName: 'get_balance'
  });

  assert.equal(result.domain, 'account');
  assert.equal(result.intent, 'check_balance');
  assert.deepEqual(result.tool, { name: 'get_balance', args: {} });
});

test('validateLlmSemanticParse builds counterparty query from tool args', () => {
  const result = validateLlmSemanticParse({
    domain: 'transactions',
    intent: 'get_last_sent_transfer_to_recipient',
    toolName: 'get_last_sent_transfer_to_recipient',
    toolArgs: { recipientName: 'dani' }
  });

  assert.equal(result.domain, 'transactions');
  assert.equal(result.intent, 'recent_transactions');
  assert.deepEqual(result.tool, {
    name: 'get_last_sent_transfer_to_recipient',
    args: { recipientName: 'dani' }
  });
  assert.deepEqual(result.semanticQuery, {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: null,
    aggregation: 'counterparty',
    limit: 10,
    recipientName: 'dani'
  });
});

test('validateLlmSemanticParse prefers semanticQuery over legacy transaction tool names', () => {
  const result = validateLlmSemanticParse({
    domain: 'transactions',
    intent: 'recent_transactions',
    toolName: 'count_transfers',
    semanticQuery: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      timeRange: null,
      aggregation: 'list',
      limit: 5
    }
  });

  assert.equal(result.domain, 'transactions');
  assert.equal(result.intent, 'recent_transactions');
  assert.equal(result.tool, null);
  assert.deepEqual(result.semanticQuery, {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: null,
    aggregation: 'list',
    limit: 5
  });
});

test('detectIntent keeps casual non-banking LLM parse unknown', async () => {
  const result = await detectIntent({
    userInput: 'מה קורה?',
    createChatCompletion: createLlmMock({
      domain: 'unknown',
      intent: 'unknown'
    })
  });

  assert.equal(result.domain, 'unknown');
  assert.equal(result.intent, 'unknown');
  assert.equal(result.semanticQuery, null);
});

test('detectIntent routes ambiguous or low-confidence classifications to unknown', async () => {
  const ambiguous = await detectIntent({
    userInput: 'תראה לי העברה',
    createChatCompletion: createLlmMock({
      domain: 'transactions',
      intent: 'transfer_money',
      confidence: 0.9,
      isAmbiguous: true,
      ambiguityReason: 'Could mean transfer history or starting a transfer'
    })
  });

  assert.equal(ambiguous.domain, 'unknown');
  assert.equal(ambiguous.intent, 'unknown');
  assert.equal(ambiguous.ambiguity?.isAmbiguous, true);
  assert.match(ambiguous.ambiguity?.reason, /history/);

  const lowConfidence = await detectIntent({
    userInput: 'העברה אולי',
    createChatCompletion: createLlmMock({
      domain: 'transactions',
      intent: 'transfer_money',
      confidence: 0.42,
      isAmbiguous: false
    })
  });

  assert.equal(lowConfidence.domain, 'unknown');
  assert.equal(lowConfidence.intent, 'unknown');
  assert.equal(lowConfidence.confidence, 0);
});

test('detectIntent resolves transaction month follow-up through LLM conversation context', async () => {
  const result = await detectIntent({
    userInput: 'של חודש שעבר',
    history: [
      { role: 'user', content: 'תביא 3 העברות אחרונות' },
      { role: 'assistant', content: 'מצאתי עבורך 3 העברות אחרונות...' }
    ],
    createChatCompletion: createLlmMock({
      domain: 'transactions',
      intent: 'recent_transactions',
      workflowContinuation: true,
      semanticQuery: {
        domain: 'transactions',
        intent: 'transactions_query',
        action: 'transfer_money',
        filters: { type: 'transfer' },
        timeRange: null,
        dateRange: { from: '2026-05-01', to: '2026-05-31' },
        aggregation: 'first_n',
        limit: 3
      }
    })
  });

  assert.equal(result.source, 'llm_semantic_parser');
  assert.deepEqual(result.workflowContinuation, { active: true });
  assert.equal(result.domain, 'transactions');
  assert.equal(result.intent, 'recent_transactions');
  assert.deepEqual(result.semanticQuery, {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: null,
    aggregation: 'first_n',
    limit: 3,
    dateRange: { from: '2026-05-01', to: '2026-05-31' }
  });
});

test('detectIntent does not treat contextless month text as a banking follow-up', async () => {
  const result = await detectIntent({
    userInput: 'של חודש שעבר',
    history: [
      { role: 'user', content: 'שלום' },
      { role: 'assistant', content: 'שלום, איך אפשר לעזור?' }
    ],
    createChatCompletion: createLlmMock({
      domain: 'unknown',
      intent: 'unknown'
    })
  });

  assert.equal(result.source, 'llm_semantic_parser');
  assert.equal(result.domain, 'unknown');
  assert.equal(result.intent, 'unknown');
  assert.equal(result.semanticQuery, null);
});

test('detectIntent returns llm_unavailable when LLM parser is unavailable', async () => {
  const result = await detectIntent({
    userInput: 'אני רוצה לבצע העברה',
    createChatCompletion: null
  });

  assert.equal(result.source, 'llm_unavailable');
  assert.equal(result.domain, 'unknown');
  assert.equal(result.intent, 'unknown');
});

test('detectIntent does not fall back to deterministic parsing when LLM is unavailable', async () => {
  const result = await detectIntent({
    userInput: 'מה הייתרה שלי?',
    createChatCompletion: null
  });

  assert.equal(result.source, 'llm_unavailable');
  assert.equal(result.domain, 'unknown');
  assert.equal(result.intent, 'unknown');
  assert.equal(result.tool, null);
});

test('detectIntent logs invalid LLM parser responses', async (t) => {
  const originalWarn = console.warn;
  let warningArgs = null;
  console.warn = (...args) => {
    warningArgs = args;
  };
  t.after(() => {
    console.warn = originalWarn;
  });

  const result = await detectIntent({
    userInput: 'מה קורה?',
    createChatCompletion: async () => ({
      choices: [{
        message: { content: 'not json' }
      }]
    })
  });

  assert.equal(result.source, 'llm_parse_failed');
  assert.match(String(warningArgs?.[0]), /assistant:intent-parser/);
  assert.equal(warningArgs?.[1]?.reason, 'parse_error');
});

test('detectIntent routes transfer start to transfer_money from LLM output', async () => {
  const result = await detectIntent({
    userInput: 'אני רוצה לבצע העברה',
    createChatCompletion: createLlmMock({
      domain: 'transactions',
      intent: 'transfer_money',
      transferPayload: null
    })
  });

  assert.equal(result.domain, 'transactions');
  assert.equal(result.intent, 'transfer_money');
});

test('validateLlmSemanticParse accepts transfer domain as transfer workflow compatibility', () => {
  const result = validateLlmSemanticParse({
    domain: 'transfer',
    intent: 'transfer_money',
    transferPayload: {
      receiverEmail: 'receiver@example.com',
      amount: 100,
      description: 'rent'
    }
  });

  assert.equal(result.domain, 'transactions');
  assert.equal(result.intent, 'transfer_money');
  assert.deepEqual(result.transferPayload, {
    receiverEmail: 'receiver@example.com',
    amount: 100,
    description: 'rent',
    confirmation: null,
    skipDescription: false,
    startNewTransfer: false
  });
});

test('detectIntent routes Hebrew profile name query from LLM output', async () => {
  const result = await detectIntent({
    userInput: 'מה השם שלי',
    createChatCompletion: createLlmMock({
      domain: 'profile',
      intent: 'get_user_name',
      toolName: 'get_user_identity'
    })
  });

  assert.equal(result.source, 'llm_semantic_parser');
  assert.equal(result.domain, 'profile');
  assert.equal(result.intent, 'show_personal_details');
  assert.deepEqual(result.tool, { name: 'get_user_identity', args: {} });
});

test('detectIntent does not override LLM output with local keyword guardrails', async () => {
  const result = await detectIntent({
    userInput: 'מה הייתרה שלי?',
    history: [
      { role: 'user', content: 'מה השם שלי?' },
      { role: 'assistant', content: 'שמך הוא Baruch Haimson. כתובת האימייל שלך היא chaimsonb2@gmail.com.' }
    ],
    createChatCompletion: createLlmMock({
      domain: 'profile',
      intent: 'show_personal_details',
      toolName: 'get_user_identity'
    })
  });

  assert.equal(result.source, 'llm_semantic_parser');
  assert.equal(result.domain, 'profile');
  assert.equal(result.intent, 'show_personal_details');
  assert.deepEqual(result.tool, { name: 'get_user_identity', args: {} });
});

test('detectIntent accepts function-style LLM tool name output', async () => {
  const result = await detectIntent({
    userInput: 'מה היתרה שלי?',
    createChatCompletion: async () => ({
      choices: [{
        message: {
          content: '{"name":"get_balance","args":{}}'
        }
      }]
    })
  });

  assert.equal(result.domain, 'account');
  assert.equal(result.intent, 'check_balance');
  assert.deepEqual(result.tool, { name: 'get_balance', args: {} });
});

test('detectIntent preserves transaction limit and model-provided dateRange from LLM', async () => {
  freezePromptDate();

  const createChatCompletion = async () => ({
    choices: [{
      message: {
        content: JSON.stringify({
          domain: 'transactions',
          intent: 'recent_transactions',
          workflowContinuation: false,
          correction: null,
          semanticQuery: {
            domain: 'transactions',
            intent: 'transactions_query',
            action: 'transfer_money',
            filters: { type: 'transfer' },
            timeRange: null,
            dateRange: { from: '2026-05-01', to: '2026-05-31' },
            aggregation: 'first_n',
            limit: 3
          }
        })
      }
    }]
  });

  const result = await detectIntent({
    userInput: 'מה הם 3 העברות האחרונות שביצעתי בחודש שעבר?',
    createChatCompletion
  });

  assert.equal(result.domain, 'transactions');
  assert.equal(result.intent, 'recent_transactions');
  assert.deepEqual(result.semanticQuery, {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: null,
    aggregation: 'first_n',
    limit: 3,
    dateRange: { from: '2026-05-01', to: '2026-05-31' },
    sortDirection: 'desc'
  });
});

test('validateLlmSemanticParse preserves explicit transaction date range', () => {
  const result = validateLlmSemanticParse({
    domain: 'transactions',
    intent: 'recent_transactions',
    semanticQuery: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      timeRange: 'last_month',
      dateRange: { from: '2026-05-01', to: '2026-05-10' },
      aggregation: 'list',
      limit: null
    }
  });

  assert.equal(result.domain, 'transactions');
  assert.equal(result.intent, 'recent_transactions');
  assert.deepEqual(result.semanticQuery, {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: null,
    aggregation: 'list',
    limit: null,
    dateRange: { from: '2026-05-01', to: '2026-05-10' }
  });
});

test('validateLlmSemanticParse rejects invalid explicit transaction date range', () => {
  const result = validateLlmSemanticParse({
    domain: 'transactions',
    intent: 'recent_transactions',
    semanticQuery: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      timeRange: null,
      dateRange: { from: '2026-05-40', to: '2026-05-10' },
      aggregation: 'list',
      limit: null
    }
  });

  assert.equal(result, null);
});

test('detectIntent keeps generic transaction type null', async () => {
  const result = await detectIntent({
    userInput: 'תראה לי פעולות אחרונות',
    createChatCompletion: createLlmMock({
      domain: 'transactions',
      intent: 'recent_transactions',
      semanticQuery: {
        domain: 'transactions',
        intent: 'transactions_query',
        action: null,
        filters: { type: null },
        timeRange: null,
        aggregation: 'list',
        limit: null
      }
    })
  });

  assert.equal(result.domain, 'transactions');
  assert.equal(result.intent, 'recent_transactions');
  assert.equal(result.semanticQuery.action, null);
  assert.equal(result.semanticQuery.filters.type, null);
  assert.equal(result.semanticQuery.timeRange, null);
  assert.equal(result.semanticQuery.aggregation, 'list');
});

test('detectIntent parses transfer count for this month without a limit', async () => {
  freezePromptDate();

  const result = await detectIntent({
    userInput: 'כמה העברות עשיתי החודש?',
    createChatCompletion: createLlmMock({
      domain: 'transactions',
      intent: 'recent_transactions',
      semanticQuery: {
        domain: 'transactions',
        intent: 'transactions_query',
        action: 'transfer_money',
        filters: { type: 'transfer' },
        timeRange: null,
        dateRange: { from: '2026-06-01', to: '2026-06-04' },
        aggregation: 'count',
        limit: null
      }
    })
  });

  assert.equal(result.domain, 'transactions');
  assert.equal(result.intent, 'recent_transactions');
  assert.equal(result.semanticQuery.action, 'transfer_money');
  assert.equal(result.semanticQuery.filters.type, 'transfer');
  assert.equal(result.semanticQuery.timeRange, null);
  assert.deepEqual(result.semanticQuery.dateRange, { from: '2026-06-01', to: '2026-06-04' });
  assert.equal(result.semanticQuery.aggregation, 'count');
  assert.equal(result.semanticQuery.limit, null);
});

test('buildSemanticParserPrompt stays workflow-state isolated', () => {
  const prompt = buildSemanticParserPrompt();

  assert.match(prompt, /"workflowContinuation":"boolean"/);
  assert.doesNotMatch(prompt, /active transfer workflow/);
  assert.doesNotMatch(prompt, /pendingFormData|lastValidationError|transferPhase/);
});
