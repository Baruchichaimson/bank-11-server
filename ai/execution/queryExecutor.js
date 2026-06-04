import { normalizeTimeRange } from './timeRangeNormalizer.js';

const DEFAULT_TRANSACTION_LIST_LIMIT = 10;
const DEFAULT_FIRST_N_LIMIT = 1;
const MAX_TRANSACTION_LIST_LIMIT = 100;

const normalizeListLimit = (value, fallback) => {
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, MAX_TRANSACTION_LIST_LIMIT);
};

export class QueryExecutor {
  constructor({ transactionRepository, accountService, profileService } = {}) {
    this.transactionRepository = transactionRepository;
    this.accountService = accountService;
    this.profileService = profileService;
  }

  async execute({ userId, userEmail = null, query }) {
    if (!query?.domain || !query?.intent) {
      throw new Error('Invalid structured query payload');
    }

    if (query.domain === 'transactions' && query.intent === 'transactions_query') {
      return this.executeTransactionsQuery({ userId, userEmail, query });
    }

    if (query.domain === 'account' && query.intent === 'get_balance') {
      const result = await this.accountService.getBalance({ userId });
      return { operation: 'get_balance', result };
    }

    if (query.domain === 'profile' && query.intent === 'get_user_name') {
      const result = await this.profileService.getIdentity({ userId });
      return { operation: 'get_user_identity', result };
    }

    throw new Error(`Unsupported domain/intent: ${query.domain}/${query.intent}`);
  }

  async executeTransactionsQuery({ userId, userEmail = null, query }) {
    if (!this.transactionRepository) {
      throw new Error('transactionRepository is required for transactions_query');
    }

    let normalizedRange;
    try {
      normalizedRange = normalizeTimeRange({
        dateRange: query.dateRange
      });
    } catch {
      return {
        operation: 'get_recent_transfers',
        result: { found: false, message: 'Invalid date range' }
      };
    }

    const { startDate, endDate } = normalizedRange;
    const baseArgs = {
      userId,
      userEmail,
      filters: query.filters || {},
      startDate,
      endDate
    };

    if (query.aggregation === 'counterparty') {
      const recipientName = String(query.recipientName || '').trim();
      if (!recipientName) {
        return {
          operation: 'get_last_sent_transfer_to_recipient',
          result: { found: false, message: 'recipientName is required' }
        };
      }

      const limit = Number.isInteger(query.limit) && query.limit > 0 ? query.limit : 10;
      const items = await this.transactionRepository.listCounterpartyByName({
        userId,
        userEmail,
        recipientName,
        limit,
        startDate,
        endDate
      });
      return {
        operation: 'get_last_sent_transfer_to_recipient',
        result: { found: true, recipientName, count: items.length, items }
      };
    }

    if (query.aggregation === 'count') {
      const count = await this.transactionRepository.countBySemanticQuery(baseArgs);
      return {
        operation: 'count_transfers',
        result: { found: true, count, from: startDate, to: endDate }
      };
    }

    if (query.aggregation === 'first_n') {
      const limit = normalizeListLimit(query.limit, DEFAULT_FIRST_N_LIMIT);
      const items = await this.transactionRepository.listBySemanticQuery({ ...baseArgs, limit, sort: 'desc' });
      return {
        operation: 'get_first_n_transfers',
        result: { found: true, count: items.length, items, from: startDate, to: endDate }
      };
    }

    if (query.aggregation === 'list' || !query.aggregation) {
      const limit = normalizeListLimit(query.limit, DEFAULT_TRANSACTION_LIST_LIMIT);
      const items = await this.transactionRepository.listBySemanticQuery({ ...baseArgs, limit, sort: 'desc' });
      return {
        operation: 'get_recent_transfers',
        result: { found: true, count: items.length, items, from: startDate, to: endDate }
      };
    }

    throw new Error(`Unsupported aggregation: ${query.aggregation}`);
  }
}