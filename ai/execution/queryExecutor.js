import { normalizeTimeRange } from './timeRangeNormalizer.js';

export class QueryExecutor {
  constructor({ transactionRepository, accountService, profileService } = {}) {
    this.transactionRepository = transactionRepository;
    this.accountService = accountService;
    this.profileService = profileService;
  }

  async execute({ userId, query }) {
    if (!query?.domain || !query?.intent) {
      throw new Error('Invalid structured query payload');
    }

    if (query.domain === 'transactions' && query.intent === 'transactions_query') {
      return this.executeTransactionsQuery({ userId, query });
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

  async executeTransactionsQuery({ userId, query }) {
    if (!this.transactionRepository) {
      throw new Error('transactionRepository is required for transactions_query');
    }

    const { startDate, endDate } = normalizeTimeRange({ timeRange: query.timeRange });
    const baseArgs = {
      userId,
      filters: query.filters || {},
      startDate,
      endDate
    };

    if (query.aggregation === 'count') {
      const count = await this.transactionRepository.countBySemanticQuery(baseArgs);
      return {
        operation: 'count_transfers',
        result: { found: true, count, from: startDate, to: endDate }
      };
    }

    if (query.aggregation === 'first_n') {
      const limit = Number.isInteger(query.limit) && query.limit > 0 ? query.limit : null;
      const items = await this.transactionRepository.listBySemanticQuery({ ...baseArgs, limit, sort: 'asc' });
      return {
        operation: 'get_first_n_transfers',
        result: { found: true, count: items.length, items, from: startDate, to: endDate }
      };
    }

    if (query.aggregation === 'list' || !query.aggregation) {
      const limit = Number.isInteger(query.limit) && query.limit > 0 ? query.limit : null;
      const items = await this.transactionRepository.listBySemanticQuery({ ...baseArgs, limit, sort: 'desc' });
      return {
        operation: 'get_recent_transfers',
        result: { found: true, count: items.length, items, from: startDate, to: endDate }
      };
    }

    throw new Error(`Unsupported aggregation: ${query.aggregation}`);
  }
}
