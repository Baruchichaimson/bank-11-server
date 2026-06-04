import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAssistantText, containsToolLeak } from '../ai/shared/textSafety.js';

test('sanitizeAssistantText strips function payload', () => {
  const input = 'hello <function name="x">{"name":"get_balance"}</function>';
  const out = sanitizeAssistantText(input);
  assert.equal(out, 'hello');
});

test('containsToolLeak detects leaked tool tokens', () => {
  assert.equal(containsToolLeak('call get_balance now'), true);
  assert.equal(containsToolLeak('A hammer is a useful tool.'), false);
  assert.equal(containsToolLeak('plain greeting'), false);
});
