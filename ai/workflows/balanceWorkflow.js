import { executeToolAndFormat } from './shared.js';

export const handleBalanceWorkflow = async (ctx) => {
  const { userId, userLanguage, transferState, shortHistory, trimmed, executeBankTool } = ctx;
  return executeToolAndFormat({
    name: 'get_balance',
    args: {},
    userId,
    userLanguage,
    transferState,
    shortHistory,
    userText: trimmed,
    executeBankTool
  });
};
