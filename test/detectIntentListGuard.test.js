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

test('detectIntent does not keep limit 1 for list-style transfer questions without explicit latest wording', async () => {
  const result = await detectIntent({
    userInput: 'מה הם העברות שביצעתי החודש?',
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
  assert.equal(result.semanticQuery.aggregation, 'list');
  assert.equal(result.semanticQuery.limit, null);
  assert.equal(result.semanticQuery.action, 'transfer_money');
  assert.deepEqual(result.semanticQuery.filters, { type: 'transfer', direction: 'outgoing' });
});

test('detectIntent preserves explicit numeric limit for list-style transfer questions', async () => {
  const result = await detectIntent({
    userInput: 'מה הם 4 העברות שביצעתי החודש?',
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

  assert.equal(result.semanticQuery.aggregation, 'first_n');
  assert.equal(result.semanticQuery.limit, 4);
  assert.equal(result.semanticQuery.sortDirection, 'desc');
  assert.deepEqual(result.semanticQuery.filters, { type: 'transfer', direction: 'outgoing' });
});
