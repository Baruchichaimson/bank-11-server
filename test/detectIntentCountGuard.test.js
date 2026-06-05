import test from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent } from '../ai/intents/before-llm/detectIntent.js';

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

test('detectIntent forces how-many transfer questions to count even when LLM returns limit 1', async () => {
  const result = await detectIntent({
    userInput: 'כמה העברות ביצעתי החודש?',
    createChatCompletion: createLlmMock({
      domain: 'transactions',
      intent: 'recent_transactions',
      toolName: 'get_recent_transfers',
      semanticQuery: {
        domain: 'transactions',
        intent: 'transactions_query',
        action: 'transfer_money',
        filters: { type: 'transfer' },
        timeRange: null,
        aggregation: 'first_n',
        limit: 1,
        sortDirection: 'desc'
      }
    })
  });

  assert.equal(result.domain, 'transactions');
  assert.equal(result.intent, 'recent_transactions');
  assert.equal(result.tool, null);
  assert.equal(result.semanticQuery.aggregation, 'count');
  assert.equal(result.semanticQuery.limit, null);
  assert.equal(result.semanticQuery.action, 'transfer_money');
  assert.deepEqual(result.semanticQuery.filters, { type: 'transfer', direction: 'outgoing' });
});
