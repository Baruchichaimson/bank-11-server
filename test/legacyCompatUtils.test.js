import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLanguage,
  normalizeIntentText,
  inferRelativeRange,
  extractTransferLimit,
  inferHighConfidenceTool,
  inferToolFromUserInput,
  inferFollowupToolFromHistory,
  interpretStatelessSemanticQuery
} from '../ai/shared/legacyCompatUtils.js';

test('detectLanguage detects Hebrew', () => {
  assert.equal(detectLanguage('מה היתרה שלי'), 'he');
  assert.equal(detectLanguage('show my balance'), 'en');
});

test('normalizeIntentText normalizes Hebrew variants', () => {
  const normalized = normalizeIntentText('מה הייתרה בחוודש קודמה');
  assert.ok(normalized.includes('יתרה'));
  assert.ok(normalized.includes('חודש'));
  assert.ok(normalized.includes('קודם'));
});

test('inferRelativeRange month parsing', () => {
  assert.deepEqual(inferRelativeRange('העברות בחודש שעבר'), { from: 'last month' });
  assert.deepEqual(inferRelativeRange('from start of month'), { from: 'start of this month' });
});

test('extractTransferLimit extracts numeric and hebrew counts', () => {
  assert.equal(extractTransferLimit('show 7 transfers'), 7);
  assert.equal(extractTransferLimit('תביא שתי העברות אחרונות'), 2);
});

test('inferHighConfidenceTool routes core intents', () => {
  assert.deepEqual(inferHighConfidenceTool('how many transfers last month')?.name, 'count_transfers');
  assert.deepEqual(inferHighConfidenceTool('מה היתרה שלי')?.name, 'get_balance');
});

test('inferToolFromUserInput handles support and transfer intents', () => {
  assert.equal(inferToolFromUserInput('I need a representative')?.name, 'open_video_call_window');
  assert.equal(inferToolFromUserInput('בצע העברה')?.name, 'open_money_transfer_window');
});

test('inferFollowupToolFromHistory recognizes month follow-up', () => {
  const history = [
    { role: 'user', content: 'תביא 3 העברות אחרונות' },
    { role: 'assistant', content: 'מצאתי עבורך 3 העברות אחרונות...' }
  ];
  const result = inferFollowupToolFromHistory('של חודש שעבר', history);
  assert.equal(result?.name, 'get_recent_transfers');
  assert.equal(result?.args?.from, 'last month');
  assert.equal(result?.args?.limit, 3);
});

test('interpretStatelessSemanticQuery: profile name', () => {
  assert.deepEqual(interpretStatelessSemanticQuery('מה השם שלי'), {
    domain: 'profile',
    intent: 'get_user_name',
    action: 'get_user_name',
    filters: { type: null },
    timeRange: null,
    aggregation: null,
    limit: null
  });
});

test('interpretStatelessSemanticQuery: balance', () => {
  assert.deepEqual(interpretStatelessSemanticQuery('מה היתרה שלי'), {
    domain: 'account',
    intent: 'get_balance',
    action: 'get_balance',
    filters: { type: null },
    timeRange: null,
    aggregation: null,
    limit: null
  });
});

test('interpretStatelessSemanticQuery: transfer list with last month', () => {
  assert.deepEqual(interpretStatelessSemanticQuery('עשיתי העברות בחודש שעבר'), {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: 'last_month',
    aggregation: 'list',
    limit: null
  });
});

test('interpretStatelessSemanticQuery: transfer count with last month', () => {
  assert.deepEqual(interpretStatelessSemanticQuery('כמה העברות ביצעתי לפני חודש'), {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: 'last_month',
    aggregation: 'count',
    limit: null
  });
});

test('interpretStatelessSemanticQuery: transfer count with this month', () => {
  assert.deepEqual(interpretStatelessSemanticQuery('כמה העברות ביצעתי החודש'), {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: 'this_month',
    aggregation: 'count',
    limit: null
  });
  assert.deepEqual(interpretStatelessSemanticQuery('כמה העברות עשיתי החודש'), {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: 'this_month',
    aggregation: 'count',
    limit: null
  });
});

test('interpretStatelessSemanticQuery: first_n transfer list', () => {
  assert.deepEqual(interpretStatelessSemanticQuery('מה היו 5 ההעברות הראשונות שלי בחודש שעבר'), {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: 'last_month',
    aggregation: 'first_n',
    limit: 5
  });
});

test('interpretStatelessSemanticQuery: Hebrew ordinal transfer limits', () => {
  assert.deepEqual(interpretStatelessSemanticQuery('מה הם 2 העברות האחרונות שביצעתי בחודש שעבר?'), {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: 'last_month',
    aggregation: 'list',
    limit: 2
  });
  assert.deepEqual(interpretStatelessSemanticQuery('מה הם 2 העברות הראשונות שביצעתי בחודש קודם?'), {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: 'last_month',
    aggregation: 'first_n',
    limit: 2
  });
  assert.deepEqual(interpretStatelessSemanticQuery('מה הם 5 העברות האחרונות שביצעתי החודש?'), {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'transfer_money',
    filters: { type: 'transfer' },
    timeRange: 'this_month',
    aggregation: 'list',
    limit: 5
  });
});

test('interpretStatelessSemanticQuery: withdraw and deposit normalization', () => {
  assert.deepEqual(interpretStatelessSemanticQuery('כמה משכתי כסף היום'), {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'withdraw_money',
    filters: { type: 'withdraw' },
    timeRange: 'today',
    aggregation: 'count',
    limit: null
  });
  assert.deepEqual(interpretStatelessSemanticQuery('רשימה של מה שהפקדתי כסף השבוע שעבר'), {
    domain: 'transactions',
    intent: 'transactions_query',
    action: 'deposit_money',
    filters: { type: 'deposit' },
    timeRange: 'last_week',
    aggregation: 'list',
    limit: null
  });
});
