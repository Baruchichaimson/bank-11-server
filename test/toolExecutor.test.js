import test from 'node:test';
import assert from 'node:assert/strict';
import { bankTools, createToolExecutor } from '../ai/bankingTools.js';

test('bankTools remains importable from bankingTools compatibility wrapper', () => {
  assert.ok(Array.isArray(bankTools));
  assert.ok(bankTools.some((tool) => tool.function?.name === 'get_balance'));
});

test('createToolExecutor routes bank tools through services', async () => {
  const calls = [];
  const services = {
    accountService: {
      getBalance: async (payload) => {
        calls.push({ method: 'accountService.getBalance', payload });
        return { found: true, balance: 10 };
      }
    },
    transactionService: {
      getTransactions: async (payload) => {
        calls.push({ method: 'transactionService.getTransactions', payload });
        return { found: true, count: 0, items: [] };
      },
      countTransfers: async (payload) => {
        calls.push({ method: 'transactionService.countTransfers', payload });
        return { found: true, count: 3 };
      },
      getLastTransfer: async (payload) => {
        calls.push({ method: 'transactionService.getLastTransfer', payload });
        return { found: true, id: 1 };
      }
    },
    profileService: {
      getUserProfile: async (payload) => {
        calls.push({ method: 'profileService.getUserProfile', payload });
        return { found: true, firstName: 'Ada' };
      }
    },
    supportService: {
      connectRepresentative: async (payload) => {
        calls.push({ method: 'supportService.connectRepresentative', payload });
        return { found: true, action: 'open_video_call' };
      }
    }
  };
  const execute = createToolExecutor({ services });

  await execute({ name: 'get_balance', userId: 'user-1' });
  await execute({ name: 'get_recent_transfers', args: { limit: 2 }, userId: 'user-1' });
  await execute({ name: 'get_last_sent_transfer_to_recipient', args: { recipientName: '' }, userId: 'user-1' });
  await execute({ name: 'count_transfers', args: { from: '2026-01-01' }, userId: 'user-1' });
  await execute({ name: 'get_last_transfer', userId: 'user-1' });
  await execute({ name: 'get_user_identity', userId: 'user-1' });
  await execute({ name: 'open_video_call_window' });

  assert.deepEqual(calls.map((call) => call.method), [
    'accountService.getBalance',
    'transactionService.getTransactions',
    'transactionService.getTransactions',
    'transactionService.countTransfers',
    'transactionService.getLastTransfer',
    'profileService.getUserProfile',
    'supportService.connectRepresentative'
  ]);
  assert.equal(calls[1].payload.operation, 'get_recent_transfers');
  assert.equal(calls[2].payload.operation, 'get_last_sent_transfer_to_recipient');
});

test('createToolExecutor keeps old unauthenticated and unsupported responses', async () => {
  const execute = createToolExecutor({ services: {} });

  assert.deepEqual(
    await execute({ name: 'get_balance' }),
    { found: false, message: 'Unauthorized request' }
  );
  assert.deepEqual(
    await execute({ name: 'unknown_tool', userId: 'user-1' }),
    { found: false, message: 'Unsupported tool: unknown_tool' }
  );
  assert.deepEqual(
    await execute({ name: 'open_money_transfer_inline' }),
    { found: true, action: { type: 'open_money_transfer_inline' } }
  );
  assert.deepEqual(
    await execute({ name: 'execute_transfer', args: { amount: 100 }, userId: 'user-1' }),
    { found: false, message: 'Unsupported tool: execute_transfer' }
  );
});
