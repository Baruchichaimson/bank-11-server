import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAmbiguousIntent,
  createIntentResult,
  createToolIntent,
  createUnknownIntent,
  normalizeIntentResult
} from '../ai/contracts/intentResultContract.js';

test('createIntentResult returns the normalized intent result shape', () => {
  const result = createIntentResult({
    domain: 'transactions',
    intent: 'transfer_money',
    confidence: 2,
    source: 'llm_semantic_parser',
    workflowContinuation: true,
    transferPayload: { amount: 10 },
    correction: { field: 'amount', value: 10 },
    toolName: 'open_money_transfer_inline',
    toolArgs: { ignored: false },
    isAmbiguous: true,
    ambiguityReason: 'Could mean two workflows'
  });

  assert.deepEqual(result, {
    domain: 'transactions',
    intent: 'transfer_money',
    confidence: 1,
    source: 'llm_semantic_parser',
    workflowContinuation: { active: true },
    semanticQuery: null,
    transferPayload: { amount: 10 },
    correction: { field: 'amount', value: 10 },
    tool: { name: 'open_money_transfer_inline', args: { ignored: false } },
    ambiguity: {
      isAmbiguous: true,
      reason: 'Could mean two workflows'
    }
  });
});

test('normalizeIntentResult maps legacy fields into tool and ambiguity objects', () => {
  const result = normalizeIntentResult({
    domain: 'account',
    intent: 'check_balance',
    confidence: 0.9,
    source: 'llm_semantic_parser',
    toolName: 'get_balance',
    toolArgs: {},
    isAmbiguous: false,
    ambiguityReason: null
  });

  assert.deepEqual(result.tool, { name: 'get_balance', args: {} });
  assert.equal(result.ambiguity, null);
});

test('createUnknownIntent, createAmbiguousIntent, and createToolIntent build common cases', () => {
  assert.deepEqual(createUnknownIntent({ source: 'llm_unavailable' }), {
    domain: 'unknown',
    intent: 'unknown',
    confidence: 0,
    source: 'llm_unavailable',
    workflowContinuation: null,
    semanticQuery: null,
    transferPayload: null,
    correction: null,
    tool: null,
    ambiguity: null
  });

  const ambiguous = createAmbiguousIntent({
    reason: 'unclear',
    transferPayload: { amount: 10 },
    tool: { name: 'open_money_transfer_inline', args: {} }
  });
  assert.deepEqual(ambiguous.ambiguity, {
    isAmbiguous: true,
    reason: 'unclear'
  });
  assert.deepEqual(ambiguous.transferPayload, { amount: 10 });
  assert.deepEqual(ambiguous.tool, { name: 'open_money_transfer_inline', args: {} });

  assert.deepEqual(
    createToolIntent({
      domain: 'support',
      intent: 'contact_support',
      name: 'open_video_call_window'
    }).tool,
    { name: 'open_video_call_window', args: {} }
  );
});
