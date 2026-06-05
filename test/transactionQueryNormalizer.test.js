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
  assert.deepEqual(normalized.filters, { type: 'transfer', direction: 'outgoing' });
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
  assert.deepEqual(normalized.filters, { type: 'transfer', direction: 'outgoing' });
  assert.deepEqual(normalized.dateRange, { from: '2026-05-01', to: '2026-05-31' });
});

test('normalizeTransactionSemanticQuery extracts incoming current-month transfer history', () => {
  const normalized = normalizeTransactionSemanticQuery({
    userInput: 'תראה לי את ההעברות שקיבלתי החודש',
    currentDate: '2026-06-04',
    semanticQuery: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      timeRange: null,
      aggregation: 'list',
      limit: null
    }
  });

  assert.equal(normalized.aggregation, 'list');
  assert.equal(normalized.limit, null);
  assert.deepEqual(normalized.filters, { type: 'transfer', direction: 'incoming' });
  assert.deepEqual(normalized.dateRange, { from: '2026-06-01', to: '2026-06-04' });
});

test('normalizeTransactionSemanticQuery extracts latest limit and last-week range', () => {
  const normalized = normalizeTransactionSemanticQuery({
    userInput: 'תראה לי 3 העברות מהשבוע האחרון',
    currentDate: '2026-06-04',
    semanticQuery: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      timeRange: null,
      aggregation: 'list',
      limit: null
    }
  });

  assert.equal(normalized.aggregation, 'first_n');
  assert.equal(normalized.limit, 3);
  assert.equal(normalized.sortDirection, 'desc');
  assert.deepEqual(normalized.filters, { type: 'transfer' });
  assert.deepEqual(normalized.dateRange, { from: '2026-05-29', to: '2026-06-04' });
});

test('normalizeTransactionSemanticQuery extracts singular latest transfer as one outgoing row', () => {
  const normalized = normalizeTransactionSemanticQuery({
    userInput: 'מה ההעברה האחרונה שביצעתי?',
    currentDate: '2026-06-04',
    semanticQuery: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      timeRange: null,
      aggregation: 'list',
      limit: null
    }
  });

  assert.equal(normalized.aggregation, 'first_n');
  assert.equal(normalized.limit, 1);
  assert.equal(normalized.sortDirection, 'desc');
  assert.deepEqual(normalized.filters, { type: 'transfer', direction: 'outgoing' });
});
