import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQueryFromCurrentMessage } from '../ai/intents/queryParser.js';

test('parseQueryFromCurrentMessage routes Hebrew ordinal transaction queries', () => {
  const latestLastMonth = parseQueryFromCurrentMessage('מה הם 2 העברות האחרונות שביצעתי בחודש שעבר?');
  assert.equal(latestLastMonth.domain, 'transactions');
  assert.equal(latestLastMonth.intent, 'recent_transactions');
  assert.equal(latestLastMonth.semanticQuery.aggregation, 'list');
  assert.equal(latestLastMonth.semanticQuery.timeRange, 'last_month');
  assert.equal(latestLastMonth.semanticQuery.limit, 2);

  const earliestPreviousMonth = parseQueryFromCurrentMessage('מה הם 2 העברות הראשונות שביצעתי בחודש קודם?');
  assert.equal(earliestPreviousMonth.domain, 'transactions');
  assert.equal(earliestPreviousMonth.intent, 'recent_transactions');
  assert.equal(earliestPreviousMonth.semanticQuery.aggregation, 'first_n');
  assert.equal(earliestPreviousMonth.semanticQuery.timeRange, 'last_month');
  assert.equal(earliestPreviousMonth.semanticQuery.limit, 2);

  const latestThisMonth = parseQueryFromCurrentMessage('מה הם 5 העברות האחרונות שביצעתי החודש?');
  assert.equal(latestThisMonth.domain, 'transactions');
  assert.equal(latestThisMonth.intent, 'recent_transactions');
  assert.equal(latestThisMonth.semanticQuery.aggregation, 'list');
  assert.equal(latestThisMonth.semanticQuery.timeRange, 'this_month');
  assert.equal(latestThisMonth.semanticQuery.limit, 5);
});
