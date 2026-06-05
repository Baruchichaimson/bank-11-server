import test from 'node:test';
import assert from 'node:assert/strict';
import { appendHistory, createReplyPayload, getWindowToolReply, getWindowToolAction } from '../ai/assistant/responseWrappers.js';

test('appendHistory appends conversation pair', () => {
  const out = appendHistory([], 'u', 'a');
  assert.equal(out.length, 2);
  assert.equal(out[0].role, 'user');
  assert.equal(out[1].role, 'assistant');
});

test('createReplyPayload returns expected structure', () => {
  const payload = createReplyPayload({ history: [], userText: 'x', reply: 'y', transferState: { phase: 'idle' }, action: 'noop' });
  assert.equal(payload.reply, 'y');
  assert.equal(payload.nextHistory.length, 2);
  assert.deepEqual(payload.nextTransferState, { phase: 'idle' });
  assert.equal(payload.action, 'noop');
});

test('window helpers map tool names', () => {
  assert.match(getWindowToolReply('open_video_call_window', 'en'), /opened the video call window/i);
  assert.equal(getWindowToolAction('open_video_call_window', {}), 'open_video_call');
  assert.deepEqual(getWindowToolAction('open_money_transfer_inline', {}), { type: 'open_money_transfer_inline' });
});
