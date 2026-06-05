import { Transaction } from '../../entities/transactions.js';
import {
  findTransactionsWithCounterpartyName,
  findTransactionsByUserId,
  transferMoney
} from '../../models/transactionsModel.js';
import { TransactionRepository } from '../repositories/transactionRepository.js';
import { QueryExecutor } from '../execution/queryExecutor.js';

const toIso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

const parseDateValue = (value) => {
  if (value instanceof Date) return value;
  const text = String(value || '').trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toDateRange = (from, to) => {
  const now = new Date();

  const hasFrom = typeof from === 'string' && from.trim() !== '';
  const hasTo = typeof to === 'string' && to.trim() !== '';

  let start = hasFrom
    ? parseDateValue(from)
    : new Date(now.getFullYear(), now.getMonth(), 1);

  let end = hasTo
    ? parseDateValue(to)
    : now;

  const invalidFrom = hasFrom && (!start || Number.isNaN(start.getTime()));
  const invalidTo = hasTo && (!end || Number.isNaN(end.getTime()));

  if (invalidFrom || invalidTo) {
    return null;
  }

  start = startOfDay(start);
  end = endOfDay(end);

  if (start > end) {
    return null;
  }

  return { start, end };
};

const formatTransfer = (tx) => ({
  id: tx.id,
  fromEmail: tx.fromEmail,
  toEmail: tx.toEmail,
  amount: Number(tx.amount) || 0,
  status: tx.status,
  description: tx.description || null,
  createdAt: toIso(tx.createdAt)
});

export const createTransactionService = ({ accountService, profileService } = {}) => {
  const transactionRepository = new TransactionRepository();
  const queryExecutor = new QueryExecutor({
    transactionRepository,
    accountService,
    profileService
  });

  const getTransfersWithCounterparty = async ({ userId, args = {} }) => {
    const safeArgs = args || {};
    const recipientName = String(safeArgs.recipientName || '').trim();

    if (!recipientName) {
      return { found: false, message: 'recipientName is required' };
    }

    const transactions = await findTransactionsWithCounterpartyName(userId, recipientName);
    const items = (transactions || []).slice(0, 10).map(formatTransfer);

    if (!items.length) {
      return {
        found: false,
        message: `No transfers found with recipient ${recipientName}`
      };
    }

    return {
      found: true,
      recipientName,
      count: items.length,
      items
    };
  };

  return {
    async executeStructuredQuery({ userId, userEmail = null, query }) {
      return queryExecutor.execute({ userId, userEmail, query });
    },

    async getTransactions({ userId, args = {}, operation = null }) {
      const safeArgs = args || {};

      if (operation === 'get_last_sent_transfer_to_recipient') {
        return getTransfersWithCounterparty({ userId, args: safeArgs });
      }

      const range = toDateRange(safeArgs.from, safeArgs.to);
      if (!range) {
        return { found: false, message: 'Invalid date range format' };
      }

      const requestedLimit = Number(safeArgs.limit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100)
        : 3;

      const transactions = await findTransactionsByUserId(userId);
      const filtered = (transactions || []).filter((tx) => {
        const createdAt = new Date(tx.createdAt);
        return createdAt >= range.start && createdAt <= range.end;
      });

      const items = filtered.slice(0, limit).map(formatTransfer);

      return {
        found: true,
        count: items.length,
        from: range.start.toISOString(),
        to: range.end.toISOString(),
        items
      };
    },

    async getLastTransfer({ userId }) {
      const transactions = await findTransactionsByUserId(userId);

      if (!transactions?.length) {
        return { found: false, message: 'No transactions found' };
      }

      return {
        found: true,
        ...formatTransfer(transactions[0])
      };
    },

    async countTransfers({ userId, args = {} }) {
      const safeArgs = args || {};
      const range = toDateRange(safeArgs.from, safeArgs.to);

      if (!range) {
        return { found: false, message: 'Invalid date range format' };
      }

      const transactions = await findTransactionsByUserId(userId);

      if (!transactions?.length) {
        return {
          found: true,
          count: 0,
          from: range.start.toISOString(),
          to: range.end.toISOString()
        };
      }

      const count = transactions.filter((tx) => {
        const createdAt = new Date(tx.createdAt);
        return createdAt >= range.start && createdAt <= range.end;
      }).length;

      return {
        found: true,
        count,
        from: range.start.toISOString(),
        to: range.end.toISOString()
      };
    },

    async getTransfersWithCounterparty({ userId, args = {} }) {
      return getTransfersWithCounterparty({ userId, args });
    },

    async openTransferForm() {
      return {
        found: true,
        action: { type: 'open_money_transfer_inline' }
      };
    },

    async executeTransfer({ fromAccountId, toAccountId, amount, description }) {
      return transferMoney({ fromAccountId, toAccountId, amount, description });
    },

    async getRecentTransactionsByEmail({ email, limit = 5 }) {
      return Transaction.find({
        $or: [{ fromEmail: email }, { toEmail: email }]
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    },

    async countMonthlyOutgoingTransfers({ email, since }) {
      return Transaction.countDocuments({
        fromEmail: email,
        createdAt: { $gte: since }
      });
    },

    async findTransactionsByUserId(userId, options = {}) {
      return findTransactionsByUserId(userId, options);
    }
  };
};
