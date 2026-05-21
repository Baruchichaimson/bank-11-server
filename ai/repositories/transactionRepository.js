import { Transaction } from '../../entities/transactions.js';
import { User } from '../../entities/users.js';

export class TransactionRepository {
  async resolveUserEmail(userId) {
    const user = await User.findById(userId).select('email').lean();
    return user?.email || null;
  }

  buildMongoFilter({ email, filters = {}, startDate, endDate }) {
    const query = {
      $or: [{ fromEmail: email }, { toEmail: email }]
    };

    if (filters?.type && filters.type !== 'transfer') {
      query._id = null;
      return query;
    }

    if (startDate || endDate) {
      query.createdAt = {
        ...(startDate ? { $gte: startDate } : {}),
        ...(endDate ? { $lte: endDate } : {})
      };
    }

    return query;
  }

  async countBySemanticQuery({ userId, filters, startDate, endDate }) {
    const email = await this.resolveUserEmail(userId);
    if (!email) return 0;

    const query = this.buildMongoFilter({ email, filters, startDate, endDate });
    return Transaction.countDocuments(query);
  }

  async listBySemanticQuery({ userId, filters, startDate, endDate, limit = null, sort = 'desc' }) {
    const email = await this.resolveUserEmail(userId);
    if (!email) return [];

    const query = this.buildMongoFilter({ email, filters, startDate, endDate });
    const cursor = Transaction.find(query).sort({ createdAt: sort === 'asc' ? 1 : -1 });

    if (Number.isInteger(limit) && limit > 0) {
      cursor.limit(limit);
    }

    return cursor.lean();
  }
}
