import { transferMoney } from '../../models/transactionsModel.js';
import { TransactionRepository } from '../repositories/transactionRepository.js';
import { QueryExecutor } from '../execution/queryExecutor.js';

export const createTransactionService = ({ accountService, profileService } = {}) => {
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

    async getTransactions({ userId, userEmail = null, args = {} }) {
      const limit = Number.isInteger(args.limit) ? args.limit : 5;
      const { result } = await queryExecutor.execute({
        userId,
        userEmail,
        query: {
          domain: 'transactions',
          intent: 'transactions_query',
          action: 'transfer_money',
          filters: { type: 'transfer' },
          dateRange: args.from || args.to ? { from: args.from || null, to: args.to || null } : null,
          timeRange: null,
          aggregation: 'list',
          limit
        }
      });
      return result;
    },

    async getLastTransfer({ userId, userEmail = null }) {
      const { result } = await queryExecutor.execute({
        userId,
        userEmail,
        query: {
          domain: 'transactions',
          intent: 'transactions_query',
          action: 'transfer_money',
          filters: { type: 'transfer' },
          dateRange: null,
          timeRange: null,
          aggregation: 'first_n',
          limit: 1
        }
      });
      const tx = result?.items?.[0];
      return tx ? { found: true, ...tx } : { found: false, message: 'No transactions found' };
    },

    async countTransfers({ userId, userEmail = null, args = {} }) {
      const { result } = await queryExecutor.execute({
        userId,
        userEmail,
        query: {
          domain: 'transactions',
          intent: 'transactions_query',
          action: 'transfer_money',
          filters: { type: 'transfer' },
          dateRange: args.from || args.to ? { from: args.from || null, to: args.to || null } : null,
          timeRange: null,
          aggregation: 'count',
          limit: null
        }
      });
      return result;
    },

    async getTransfersWithCounterparty({ userId, userEmail = null, args = {} }) {
      const recipientName = String(args.recipientName || '').trim();
      if (!recipientName) {
        return { found: false, message: 'recipientName is required' };
      }
      const { result } = await queryExecutor.execute({
        userId,
        userEmail,
        query: {
          domain: 'transactions',
          intent: 'transactions_query',
          action: 'transfer_money',
          filters: { type: 'transfer' },
          dateRange: args.from || args.to ? { from: args.from || null, to: args.to || null } : null,
          timeRange: null,
          aggregation: 'counterparty',
          recipientName,
          limit: 10
        }
      });
      return result;
    },

    async openTransferForm({ userId }) {
      return { found: true, action: { type: 'open_money_transfer_inline' }, userId };
    },

    async executeTransfer({ fromAccountId, toAccountId, amount, description }) {
      return transferMoney({ fromAccountId, toAccountId, amount, description });
    },

    async getRecentTransactionsByEmail({ email, limit = 5 }) {
      return transactionRepository.listRecentByEmail({ email, limit });
    },

    async countMonthlyOutgoingTransfers({ email, since }) {
      return transactionRepository.countOutgoingSince({ email, since });
    },

    async findTransactionsByUserId(userId, options = {}) {
      return transactionRepository.listByUserId(userId, options);
    }
  };
};
