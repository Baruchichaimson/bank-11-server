import test from 'node:test';
import assert from 'node:assert/strict';
import { getFriendlyErrorReply, formatFinancialResponse } from '../ai/assistant/responseFormatting.js';

test('getFriendlyErrorReply returns localized unauthorized message', () => {
  assert.match(getFriendlyErrorReply('unauthorized', 'en'), /sign in again/i);
  assert.match(getFriendlyErrorReply('unauthorized', 'he'), /להתחבר מחדש/);
});

test('formatFinancialResponse formats balance in EN and HE', () => {
  const result = { found: true, balance: 1200, currency: 'ILS', status: 'active' };
  assert.match(formatFinancialResponse('get_balance', result, 'en'), /Your current balance is 1200 ILS/);
  assert.match(formatFinancialResponse('get_balance', result, 'he'), /היתרה הנוכחית שלך היא 1200 ILS/);
});

test('formatFinancialResponse handles invalid date range', () => {
  const reply = formatFinancialResponse('get_recent_transfers', { found: false, message: 'invalid date range' }, 'en');
  assert.match(reply, /could not parse the date range/i);
});
