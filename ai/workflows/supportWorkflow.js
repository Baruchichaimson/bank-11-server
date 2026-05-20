import { executeToolAndFormat } from './shared.js';

export const handleSupportWorkflow = async (ctx) => {
  const { userId, userLanguage, transferState, shortHistory, trimmed, executeBankTool } = ctx;
  return executeToolAndFormat({
    name: 'open_video_call_window',
    args: {},
    userId,
    userLanguage,
    transferState,
    shortHistory,
    userText: trimmed,
    executeBankTool
  });
};
