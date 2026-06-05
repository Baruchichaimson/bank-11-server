import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTransactionSemanticQuery, resolveDateRangeFromText } from '../ai/intents/after-llm/transactionQueryNormalizer.js';

test('resolveDateRangeFromText handles relative Hebrew month ranges', () => {
  const currentDate = '2026-06-04';

  assert.deepEqual(
    resolveDateRangeFromText({ userInput: 'כמה העברות ביצעתי החודש?', currentDate }),
    { from: '2026-06-01', to: '2026-06-04' }
  );

  assert.deepEqual(
    resolveDateRangeFromText({ userInput: 'מה הם 3 העברות בחודש שעבר?', currentDate }),
    { from: '2026-05-01', to: '2026-05-31' }
  );

  assert.deepEqual(
    resolveDateRangeFromText({ userInput: 'כמה העברות ביצעתי לפני חודשיים?', currentDate }),
    { from: '2026-04-01', to: '2026-04-30' }
  );

  assert.deepEqual(
    resolveDateRangeFromText({ userInput: 'כמה העברות ביצעתי בחודשיים האחרונים?', currentDate }),
    { from: '2026-05-01', to: '2026-06-04' }
  );
});

test('normalizeTransactionSemanticQuery forces count for how-many questions', () => {
  const normalized = normalizeTransactionSemanticQuery({
    userInput: 'כמה העברות ביצעתי בחודשיים האחרונים?',
    currentDate: '2026-06-04',
    semanticQuery: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: null,
      filters: { type: null },
      timeRange: null,
      aggregation: 'list',
      limit: 10
    }
  });

  assert.equal(normalized.aggregation, 'count');
  assert.equal(normalized.limit, null);
  assert.equal(normalized.action, 'transfer_money');
  assert.deepEqual(normalized.filters, { type: 'transfer' });
  assert.deepEqual(normalized.dateRange, { from: '2026-05-01', to: '2026-06-04' });
});

test('normalizeTransactionSemanticQuery forces limit and ascending sort for first transfer requests', () => {
  const normalized = normalizeTransactionSemanticQuery({
    userInput: 'מה הם 3 העברות הראשונות שביצעתי בחודש שעבר?',
    currentDate: '2026-06-04',
    semanticQuery: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      timeRange: null,
      aggregation: 'list',
      limit: 10,
      sortDirection: 'desc'
    }
  });

  assert.equal(normalized.aggregation, 'first_n');
  assert.equal(normalized.limit, 3);
  assert.equal(normalized.sortDirection, 'asc');
  assert.deepEqual(normalized.dateRange, { from: '2026-05-01', to: '2026-05-31' });
});
