import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyWorkflowResponse,
  createExecutedWorkflowResponse,
  createWorkflowResponse,
  normalizeWorkflowResponse
} from '../ai/contracts/assistantResponseContract.js';

test('createWorkflowResponse returns the unified workflow response shape', () => {
  const response = createWorkflowResponse({
    message: 'hello',
    action: { type: 'transfer_form_error', field: 'amount', message: 'invalid' },
    nextConversationState: { phase: 'form_open' },
    execution: {
      executed: true,
      operation: 'transfer_money',
      result: { found: true }
    }
  });

  assert.deepEqual(response, {
    message: 'hello',
    action: {
      type: 'transfer_form_error',
      payload: { field: 'amount', message: 'invalid' }
    },
    nextConversationState: { phase: 'form_open' },
    execution: {
      executed: true,
      operation: 'transfer_money',
      result: { found: true }
    }
  });
});

test('createExecutedWorkflowResponse and createEmptyWorkflowResponse set execution defaults', () => {
  assert.deepEqual(
    createExecutedWorkflowResponse({ operation: 'get_balance', result: { balance: 10 } }).execution,
    { executed: true, operation: 'get_balance', result: { balance: 10 } }
  );

  assert.deepEqual(
    createEmptyWorkflowResponse().execution,
    { executed: false, operation: null, result: null }
  );
});

test('normalizeWorkflowResponse maps legacy workflow fields to the new contract', () => {
  const response = normalizeWorkflowResponse({
    reply: 'legacy reply',
    action: 'open_video_call',
    nextTransferState: { phase: 'idle' },
    execution: {
      executed: true,
      result: { action: 'open_video_call' }
    }
  });

  assert.deepEqual(response, {
    message: 'legacy reply',
    action: { type: 'open_video_call' },
    nextConversationState: { phase: 'idle' },
    execution: {
      executed: true,
      operation: null,
      result: { action: 'open_video_call' }
    }
  });
});
