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

  async listCounterpartyByName({ userId, recipientName, limit = 10, startDate = null, endDate = null }) {
    const email = await this.resolveUserEmail(userId);
    if (!email) return [];

    const normalizedName = String(recipientName || '').trim();
    if (!normalizedName) return [];

    const safeName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const counterpartyEmailRegex = new RegExp(`^${safeName}@`, 'i');
    const query = {
      $or: [
        { fromEmail: email, toEmail: counterpartyEmailRegex },
        { fromEmail: counterpartyEmailRegex, toEmail: email }
      ]
    };

    if (startDate || endDate) {
      query.createdAt = {
        ...(startDate ? { $gte: startDate } : {}),
        ...(endDate ? { $lte: endDate } : {})
      };
    }

    const cursor = Transaction.find(query).sort({ createdAt: -1 });

    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 10;
    cursor.limit(safeLimit);
    return cursor.lean();
  }
}
