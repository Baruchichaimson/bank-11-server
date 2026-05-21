import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLanguage,
  normalizeIntentText,
  inferRelativeRange,
  extractTransferLimit,
  inferHighConfidenceTool,
  inferToolFromUserInput,
  inferFollowupToolFromHistory
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
