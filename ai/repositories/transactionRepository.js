import { Transaction } from '../../entities/transactions.js';
import { User } from '../../entities/users.js';
import {
  findTransactionsWithCounterpartyName,
  findTransactionsByUserId,
  transferMoney
} from '../../models/transactionsModel.js';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

export class TransactionRepository {
  async resolveUserEmail({ userId, userEmail = null }) {
    const normalized = normalizeEmail(userEmail);
    if (normalized) return normalized;

    const user = await User.findById(userId).select('email').lean();
    return normalizeEmail(user?.email) || null;
  }

  buildMongoFilter({ email, filters = {}, startDate, endDate }) {
    const direction = filters?.direction;
    const query = direction === 'outgoing'
      ? { fromEmail: email }
      : direction === 'incoming'
        ? { toEmail: email }
        : { $or: [{ fromEmail: email }, { toEmail: email }] };

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

  async countBySemanticQuery({ userId, userEmail = null, filters, startDate, endDate }) {
    const email = await this.resolveUserEmail({ userId, userEmail });
    if (!email) return 0;

    const query = this.buildMongoFilter({ email, filters, startDate, endDate });
    return Transaction.countDocuments(query);
  }

  async listBySemanticQuery({ userId, userEmail = null, filters, startDate, endDate, limit = null, sort = 'desc' }) {
    const email = await this.resolveUserEmail({ userId, userEmail });
    if (!email) return [];

    const query = this.buildMongoFilter({ email, filters, startDate, endDate });
    const cursor = Transaction.find(query).sort({ createdAt: sort === 'asc' ? 1 : -1 });

    if (Number.isInteger(limit) && limit > 0) {
      cursor.limit(limit);
    }

    return cursor.lean();
  }

  async listCounterpartyByName({ userId, userEmail = null, recipientName, limit = 10, startDate = null, endDate = null }) {
    const email = await this.resolveUserEmail({ userId, userEmail });
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

  async findTransactionsWithCounterpartyName(userId, recipientName) {
    return findTransactionsWithCounterpartyName(userId, recipientName);
  }

  async findTransactionsByUserId(userId, options = {}) {
    return findTransactionsByUserId(userId, options);
  }

  async executeTransfer({ fromAccountId, toAccountId, amount, description }) {
    return transferMoney({ fromAccountId, toAccountId, amount, description });
  }

  async listRecentByEmail({ email, limit = 5 }) {
    return Transaction.find({
      $or: [{ fromEmail: email }, { toEmail: email }]
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async countMonthlyOutgoingTransfers({ email, since }) {
    return Transaction.countDocuments({
      fromEmail: email,
      createdAt: { $gte: since }
    });
  }

  async hasBeneficiaryHistory({ senderEmail, receiverEmail }) {
    return Transaction.exists({
      fromEmail: senderEmail,
      toEmail: receiverEmail
    });
  }

  async countOutgoingSince({ email, since }) {
    return Transaction.countDocuments({
      fromEmail: email,
      createdAt: { $gte: since }
    });
  }
}
