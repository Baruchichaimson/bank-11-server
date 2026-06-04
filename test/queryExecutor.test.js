import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryExecutor } from '../ai/execution/queryExecutor.js';
import { normalizeTimeRange } from '../ai/execution/timeRangeNormalizer.js';

const createTransactionRepositoryStub = (calls = []) => ({
  countBySemanticQuery: async (args) => {
    calls.push({ method: 'countBySemanticQuery', ...args });
    return 11;
  },
  listBySemanticQuery: async (args) => {
    calls.push({ method: 'listBySemanticQuery', ...args });
    const { sort, limit } = args;
    const rows = [
      { id: 1, createdAt: new Date('2026-04-01T10:00:00.000Z') },
      { id: 2, createdAt: new Date('2026-04-10T10:00:00.000Z') },
      { id: 3, createdAt: new Date('2026-04-20T10:00:00.000Z') }
    ];
    const ordered = sort === 'asc' ? rows : [...rows].reverse();
    return Number.isInteger(limit) ? ordered.slice(0, limit) : ordered;
  },
  listCounterpartyByName: async (args) => {
    calls.push({ method: 'listCounterpartyByName', ...args });
    return [
      { id: 7, amount: 42, fromEmail: 'u@example.com', toEmail: `${args.recipientName}@example.com` }
    ];
  }
});

test('QueryExecutor routes count aggregation with model-provided dateRange to count operation', async () => {
  const executor = new QueryExecutor({ transactionRepository: createTransactionRepositoryStub() });

  const { operation, result } = await executor.executeTransactionsQuery({
    userId: 'u1',
    query: {
      domain: 'transactions',
      intent: 'transactions_query',
      filters: { type: 'transfer' },
      timeRange: null,
      dateRange: { from: '2026-05-01', to: '2026-05-31' },
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

test('normalizeTimeRange converts model-provided ISO dateRange to createdAt bounds', () => {
  const iso = normalizeTimeRange({
    dateRange: { from: '2026-05-01', to: '2026-05-10' }
  });

  assert.equal(iso.label, 'date_range');
  assert.equal(iso.startDate.getFullYear(), 2026);
  assert.equal(iso.startDate.getMonth(), 4);
  assert.equal(iso.startDate.getDate(), 1);
  assert.equal(iso.startDate.getHours(), 0);
  assert.equal(iso.endDate.getFullYear(), 2026);
  assert.equal(iso.endDate.getMonth(), 4);
  assert.equal(iso.endDate.getDate(), 10);
  assert.equal(iso.endDate.getHours(), 23);
});

test('normalizeTimeRange rejects non-ISO dateRange values', () => {
  assert.throws(
    () => normalizeTimeRange({ dateRange: { from: '03/06/2026', to: '05.06.2026' } }),
    /Invalid date range/
  );
});

test('QueryExecutor routes list aggregation to descending list operation', async () => {
  const executor = new QueryExecutor({ transactionRepository: createTransactionRepositoryStub() });

  const { operation, result } = await executor.executeTransactionsQuery({
    userId: 'u1',
    query: {
      domain: 'transactions',
      intent: 'transactions_query',
      filters: { type: 'transfer' },
      timeRange: null,
      aggregation: 'list',
      limit: null
    }
  });

  assert.equal(operation, 'get_recent_transfers');
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].id, 3);
});

test('QueryExecutor applies dateRange and ignores legacy timeRange when both are present', async () => {
  const calls = [];
  const executor = new QueryExecutor({ transactionRepository: createTransactionRepositoryStub(calls) });

  await executor.executeTransactionsQuery({
    userId: 'u1',
    query: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      timeRange: 'last_month',
      dateRange: { from: '2026-05-01', to: '2026-05-10' },
      aggregation: 'list',
      limit: null
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].startDate.getFullYear(), 2026);
  assert.equal(calls[0].startDate.getMonth(), 4);
  assert.equal(calls[0].startDate.getDate(), 1);
  assert.equal(calls[0].endDate.getFullYear(), 2026);
  assert.equal(calls[0].endDate.getMonth(), 4);
  assert.equal(calls[0].endDate.getDate(), 10);
});

test('QueryExecutor routes first_n aggregation to descending limited list operation', async () => {
  const executor = new QueryExecutor({ transactionRepository: createTransactionRepositoryStub() });

  const { operation, result } = await executor.executeTransactionsQuery({
    userId: 'u1',
    query: {
      domain: 'transactions',
      intent: 'transactions_query',
      filters: { type: 'transfer' },
      timeRange: null,
      aggregation: 'first_n',
      limit: 2
    }
  });

  assert.equal(operation, 'get_first_n_transfers');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].id, 3);
  assert.equal(result.items[1].id, 2);
});

test('QueryExecutor applies transaction type, dateRange, and limit for latest transfer query', async () => {
  const calls = [];
  const executor = new QueryExecutor({ transactionRepository: createTransactionRepositoryStub(calls) });

  const { result } = await executor.executeTransactionsQuery({
    userId: 'u1',
    query: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      timeRange: null,
      dateRange: { from: '2026-05-01', to: '2026-05-31' },
      aggregation: 'first_n',
      limit: 3
    }
  });

  assert.equal(result.items.length, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'listBySemanticQuery');
  assert.deepEqual(calls[0].filters, { type: 'transfer' });
  assert.ok(calls[0].startDate instanceof Date);
  assert.ok(calls[0].endDate instanceof Date);
  assert.equal(calls[0].limit, 3);
  assert.equal(calls[0].sort, 'desc');
});

test('QueryExecutor routes counterparty aggregation to recipient lookup operation', async () => {
  const calls = [];
  const executor = new QueryExecutor({ transactionRepository: createTransactionRepositoryStub(calls) });

  const { operation, result } = await executor.executeTransactionsQuery({
    userId: 'u1',
    query: {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      timeRange: null,
      dateRange: { from: '2026-05-01', to: '2026-05-10' },
      aggregation: 'counterparty',
      limit: 10,
      recipientName: 'dani'
    }
  });

  assert.equal(operation, 'get_last_sent_transfer_to_recipient');
  assert.equal(result.recipientName, 'dani');
  assert.equal(result.items.length, 1);
  assert.equal(calls[0].method, 'listCounterpartyByName');
  assert.equal(calls[0].recipientName, 'dani');
  assert.equal(calls[0].startDate.getDate(), 1);
  assert.equal(calls[0].endDate.getDate(), 10);
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
