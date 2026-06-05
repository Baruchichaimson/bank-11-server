export const createToolExecutor = ({ services } = {}) => async ({ name, args = {}, userId } = {}) => {
  if (name === 'open_video_call_window') {
    return services.supportService.connectRepresentative({ userId });
  }

  if (name === 'open_money_transfer_inline') {
    return {
      found: true,
      action: { type: 'open_money_transfer_inline' }
    };
  }

  if (!userId) {
    return { found: false, message: 'Unauthorized request' };
  }

  const safeArgs = args || {};

  if (name === 'get_user_identity') {
    return services.profileService.getUserProfile({ userId });
  }

  if (name === 'get_balance') {
    return services.accountService.getBalance({ userId });
  }

  if (name === 'get_last_transfer') {
    return services.transactionService.getLastTransfer({ userId });
  }

  if (name === 'count_transfers') {
    return services.transactionService.countTransfers({ userId, args: safeArgs });
  }

  if (name === 'get_last_sent_transfer_to_recipient') {
    return services.transactionService.getTransactions({ userId, args: safeArgs, operation: name });
  }

  if (name === 'get_recent_transfers') {
    return services.transactionService.getTransactions({ userId, args: safeArgs, operation: name });
  }

  return {
    found: false,
    message: `Unsupported tool: ${name}`
  };
};
