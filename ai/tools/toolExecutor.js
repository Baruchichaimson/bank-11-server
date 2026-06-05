const toIso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const buildDateRangeQuery = ({ from = null, to = null } = {}) => ({
  domain: 'transactions',
  intent: 'transactions_query',
  action: 'transfer_money',
  filters: { type: 'transfer' },
  dateRange: from || to ? { from: from || null, to: to || null } : null,
  timeRange: null
});

const mapTransactionItem = (tx) => ({
  id: tx.id ?? tx._id,
  fromEmail: tx.fromEmail,
  toEmail: tx.toEmail,
  amount: Number(tx.amount) || 0,
  status: tx.status,
  description: tx.description || null,
  createdAt: toIso(tx.createdAt)
});

export const createToolExecutor = ({ services } = {}) => async ({ name, args = {}, userId }) => {
  if (name === 'open_video_call_window') {
    return {
      found: true,
      action: 'open_video_call'
    };
  }

  if (name === 'open_money_transfer_inline') {
    return services?.transactionService?.openTransferForm
      ? services.transactionService.openTransferForm({ userId })
      : { found: true, action: { type: 'open_money_transfer_inline' } };
  }

  if (!userId) {
    return { found: false, message: 'Unauthorized request' };
  }

  if (name === 'get_user_identity') {
    return services.profileService.getUserProfile({ userId });
  }

  if (name === 'get_balance') {
    return services.accountService.getBalance({ userId });
  }

  if (name === 'get_last_transfer') {
    const items = await services.transactionService.findTransactionsByUserId(userId, { limit: 1 });
    const tx = items?.[0];
    return tx
      ? { found: true, ...mapTransactionItem(tx) }
      : { found: false, message: 'No transactions found' };
  }

  if (name === 'count_transfers') {
    const { result } = await services.transactionService.executeStructuredQuery({
      userId,
      query: {
        ...buildDateRangeQuery(args),
        aggregation: 'count',
        limit: null
      }
    });
    return result;
  }

  if (name === 'get_recent_transfers') {
    const requestedLimit = Number(args?.limit);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100)
      : null;
    const { result } = await services.transactionService.executeStructuredQuery({
      userId,
      query: {
        ...buildDateRangeQuery(args),
        aggregation: 'list',
        limit
      }
    });
    return result;
  }

  if (name === 'get_last_sent_transfer_to_recipient') {
    const recipientName = String(args?.recipientName || '').trim();
    if (!recipientName) {
      return { found: false, message: 'recipientName is required' };
    }
    const { result } = await services.transactionService.executeStructuredQuery({
      userId,
      query: {
        ...buildDateRangeQuery(args),
        aggregation: 'counterparty',
        recipientName,
        limit: 10
      }
    });
    return result;
  }

  return {
    found: false,
    message: `Unsupported tool: ${name}`
  };
};
