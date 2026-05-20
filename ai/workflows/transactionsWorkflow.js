import { createReplyPayload, executeToolAndFormat } from './shared.js';

const normalize = (text) => String(text || '').toLowerCase();
const extractLimit = (text) => {
  const m = normalize(text).match(/(?:^|\s)(\d{1,3})(?:\s+)?(?:העברה|העברות|transfer|transfers)/);
  return m ? Math.min(Math.max(Number(m[1]), 1), 100) : null;
};

const inferTool = (text) => {
  const value = normalize(text);
  if (value.includes('count transfers') || value.includes('כמה העברות')) return { name: 'count_transfers', args: {} };
  if (value.includes('last transfer') || value.includes('העברה אחרונה')) return { name: 'get_last_transfer', args: {} };
  const limit = extractLimit(value);
  return { name: 'get_recent_transfers', args: limit ? { limit } : { limit: 5 } };
};

export const handleTransactionsWorkflow = async (ctx) => {
  const {
    trimmed, shortHistory, userLanguage, transferState, userId, executeBankTool
  } = ctx;
  if (normalize(trimmed).includes('אבל ביקשתי')) {
    return createReplyPayload({
      history: shortHistory,
      userText: trimmed,
      reply: userLanguage === 'he'
        ? 'אם לא הוחזרו מספיק תוצאות, כנראה שאין מספיק העברות בטווח הזמן שנבחר. אפשר להרחיב טווח זמן.'
        : 'If fewer results were returned, there may not be enough transfers in that date range. You can widen the range.',
      transferState,
      action: null
    });
  }
  const inferred = inferTool(trimmed);
  return executeToolAndFormat({
    name: inferred.name,
    args: inferred.args,
    userId,
    userLanguage,
    transferState,
    shortHistory,
    userText: trimmed,
    executeBankTool
  });
};
