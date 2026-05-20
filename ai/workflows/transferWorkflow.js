import { runTransferGraph } from '../transferGraph.js';
import { createReplyPayload, executeToolAndFormat } from './shared.js';

export const handleTransferWorkflow = async (ctx) => {
  const {
    trimmed, userLanguage, userId, transferState, shortHistory, executeBankTool
  } = ctx;
  const transferFlow = await runTransferGraph({
    userInput: trimmed,
    userLanguage,
    userId,
    transferState
  });
  if (transferFlow.handled) {
    return createReplyPayload({
      history: shortHistory,
      userText: trimmed,
      reply: transferFlow.reply,
      transferState: transferFlow.nextTransferState,
      action: transferFlow.action || null
    });
  }
  return executeToolAndFormat({
    name: 'open_money_transfer_window',
    args: {},
    userId,
    userLanguage,
    transferState,
    shortHistory,
    userText: trimmed,
    executeBankTool
  });
};
