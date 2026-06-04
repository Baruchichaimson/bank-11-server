import { Transaction } from '../../entities/transactions.js';
import {
  findTransactionsByUserId,
  transferMoney
} from '../../models/transactionsModel.js';
import { TransactionRepository } from '../repositories/transactionRepository.js';
import { QueryExecutor } from '../execution/queryExecutor.js';

export const createTransactionService = ({ executeBankTool, accountService, profileService } = {}) => {
  const transactionRepository = new TransactionRepository();
  const queryExecutor = new QueryExecutor({
    transactionRepository,
    accountService,
    profileService
  });

  return {
    async executeStructuredQuery({ userId, userEmail = null, query }) {
      return queryExecutor.execute({ userId, userEmail, query });
    },

    async getTransactions({ userId, args = {} }) {
      if (!executeBankTool) {
        const limit = Number.isInteger(args.limit) ? args.limit : 5;
        const items = await findTransactionsByUserId(userId, { limit });
        return { found: true, count: items.length, items };
      }
      return executeBankTool({ name: 'get_recent_transfers', args, userId });
    },

    async getLastTransfer({ userId }) {
      if (!executeBankTool) {
        const items = await findTransactionsByUserId(userId, { limit: 1 });
        return items[0] ? { found: true, ...items[0] } : { found: false, message: 'No transactions found' };
      }
      return executeBankTool({ name: 'get_last_transfer', args: {}, userId });
    },

    async countTransfers({ userId, args = {} }) {
      if (!executeBankTool) {
        const items = await findTransactionsByUserId(userId);
        return { found: true, count: items.length, from: args.from || '', to: args.to || '' };
      }
      return executeBankTool({ name: 'count_transfers', args, userId });
    },

    async getTransfersWithCounterparty({ userId, args = {} }) {
      if (!executeBankTool) {
        return { found: false, message: 'Counterparty lookup unavailable' };
      }
      return executeBankTool({ name: 'get_last_sent_transfer_to_recipient', args, userId });
    },

    async openTransferForm({ userId }) {
      if (!executeBankTool) {
        return { found: true, action: { type: 'open_money_transfer_inline' }, userId };
      }
      return executeBankTool({ name: 'open_money_transfer_inline', args: {}, userId });
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