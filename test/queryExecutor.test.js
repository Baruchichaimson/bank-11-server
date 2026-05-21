import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryExecutor } from '../ai/execution/queryExecutor.js';

const createTransactionRepositoryStub = () => ({
  countBySemanticQuery: async () => 11,
  listBySemanticQuery: async ({ sort, limit }) => {
    const rows = [
      { id: 1, createdAt: new Date('2026-04-01T10:00:00.000Z') },
      { id: 2, createdAt: new Date('2026-04-10T10:00:00.000Z') },
      { id: 3, createdAt: new Date('2026-04-20T10:00:00.000Z') }
    ];
    const ordered = sort === 'asc' ? rows : [...rows].reverse();
    return Number.isInteger(limit) ? ordered.slice(0, limit) : ordered;
  }
});

test('QueryExecutor routes count aggregation to count operation with normalized last_month range', async () => {
  const executor = new QueryExecutor({ transactionRepository: createTransactionRepositoryStub() });

  const { operation, result } = await executor.executeTransactionsQuery({
    userId: 'u1',
    query: {
      domain: 'transactions',
      intent: 'transactions_query',
      filters: { type: 'transfer' },
      timeRange: 'last_month',
      aggregation: 'count',
      limit: null
    }
  });

  assert.equal(operation, 'count_transfers');
  assert.equal(result.count, 11);
  assert.equal(result.items, undefined);
  assert.ok(result.from instanceof Date);
  assert.ok(result.to instanceof Date);
});

test('QueryExecutor routes list aggregation to descending list operation', async () => {
  const executor = new QueryExecutor({ transactionRepository: createTransactionRepositoryStub() });

  const { operation, result } = await executor.executeTransactionsQuery({
    userId: 'u1',
    query: {
      domain: 'transactions',
      intent: 'transactions_query',
      filters: { type: 'transfer' },
      timeRange: 'last_month',
      aggregation: 'list',
      limit: null
    }
  });

  assert.equal(operation, 'get_recent_transfers');
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].id, 3);
});

test('QueryExecutor routes first_n aggregation to ascending limited list operation', async () => {
  const executor = new QueryExecutor({ transactionRepository: createTransactionRepositoryStub() });

  const { operation, result } = await executor.executeTransactionsQuery({
    userId: 'u1',
    query: {
      domain: 'transactions',
      intent: 'transactions_query',
      filters: { type: 'transfer' },
      timeRange: 'last_month',
      aggregation: 'first_n',
      limit: 2
    }
  });

  assert.equal(operation, 'get_first_n_transfers');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].id, 1);
  assert.equal(result.items[1].id, 2);
});

test('QueryExecutor keeps domain isolation for profile/account', async () => {
  const executor = new QueryExecutor({
    transactionRepository: createTransactionRepositoryStub(),
    accountService: { getBalance: async () => ({ found: true, balance: 10, currency: 'ILS', status: 'ACTIVE' }) },
    profileService: { getIdentity: async () => ({ found: true, firstName: 'A', lastName: 'B', email: 'a@b.c' }) }
  });

  const balanceResult = await executor.execute({
    userId: 'u1',
    query: { domain: 'account', intent: 'get_balance' }
  });
  assert.equal(balanceResult.operation, 'get_balance');

  const profileResult = await executor.execute({
    userId: 'u1',
    query: { domain: 'profile', intent: 'get_user_name' }
  });
  assert.equal(profileResult.operation, 'get_user_identity');
});
