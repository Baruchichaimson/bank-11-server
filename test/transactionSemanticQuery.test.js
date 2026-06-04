import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSemanticParserPrompt, validateLlmSemanticParse } from '../ai/intents/llmSemanticParser.js';
import { QueryExecutor } from '../ai/execution/queryExecutor.js';

const buildTransactionParse = ({ limit, dateRange, sortDirection }) => validateLlmSemanticParse({
  domain: 'transactions',
  intent: 'recent_transactions',
  confidence: 0.95,
  semanticQuery: {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: null,
    dateRange,
    aggregation: 'first_n',
    limit,
    sortDirection
  }
});

test('semantic parser prompt explains Hebrew previous-month transfer history limits and sort direction', () => {
  const prompt = buildSemanticParserPrompt();

  assert.match(prompt, /חודש שעבר/);
  assert.match(prompt, /חודש קודם/);
  assert.match(prompt, /full previous calendar month/i);
  assert.match(prompt, /שתיים=2/);
  assert.match(prompt, /ארבע=4/);
  assert.match(prompt, /sortDirection to desc/);
  assert.match(prompt, /sortDirection to asc/);
});

test('validateLlmSemanticParse preserves latest previous-month transfer query semantics', () => {
  const result = buildTransactionParse({
    limit: 2,
    dateRange: { from: '2026-05-01', to: '2026-05-31' },
    sortDirection: 'desc'
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
    limit: 2,
    dateRange: { from: '2026-05-01', to: '2026-05-31' },
    sortDirection: 'desc'
  });
});

test('validateLlmSemanticParse preserves earliest previous-month transfer query semantics', () => {
  const result = buildTransactionParse({
    limit: 4,
    dateRange: { from: '2026-05-01', to: '2026-05-31' },
    sortDirection: 'asc'
  });

  assert.deepEqual(result.semanticQuery, {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: null,
    aggregation: 'first_n',
    limit: 4,
    dateRange: { from: '2026-05-01', to: '2026-05-31' },
    sortDirection: 'asc'
  });
});

test('QueryExecutor sends latest transfer-history requests as descending createdAt queries', async () => {
  let capturedArgs = null;
  const executor = new QueryExecutor({
    transactionRepository: {
      async listBySemanticQuery(args) {
        capturedArgs = args;
        return [];
      }
    }
  });

  await executor.execute({
    userId: 'user-1',
    userEmail: 'user@example.com',
    query: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      dateRange: { from: '2026-05-01', to: '2026-05-31' },
      aggregation: 'first_n',
      limit: 3,
      sortDirection: 'desc'
    }
  });

  assert.equal(capturedArgs.limit, 3);
  assert.equal(capturedArgs.sort, 'desc');
  assert.deepEqual(capturedArgs.filters, { type: 'transfer' });
  assert.equal(capturedArgs.startDate.toISOString(), '2026-04-30T21:00:00.000Z');
  assert.equal(capturedArgs.endDate.toISOString(), '2026-05-31T20:59:59.999Z');
});

test('QueryExecutor sends earliest transfer-history requests as ascending createdAt queries', async () => {
  let capturedArgs = null;
  const executor = new QueryExecutor({
    transactionRepository: {
      async listBySemanticQuery(args) {
        capturedArgs = args;
        return [];
      }
    }
  });

  await executor.execute({
    userId: 'user-1',
    userEmail: 'user@example.com',
    query: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      dateRange: { from: '2026-05-01', to: '2026-05-31' },
      aggregation: 'first_n',
      limit: 4,
      sortDirection: 'asc'
    }
  });

  assert.equal(capturedArgs.limit, 4);
  assert.equal(capturedArgs.sort, 'asc');
  assert.deepEqual(capturedArgs.filters, { type: 'transfer' });
});
