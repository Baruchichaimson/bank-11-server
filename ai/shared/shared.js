export const MAX_HISTORY = 12;

export const sanitizeAssistantText = (text) => {
  return String(text || '')
    .replace(/<function[\s\S]*$/gi, '')
    .replace(/<\/?function[^>]*>/gi, '')
    .replace(/\{[\s\S]*?"name"\s*:\s*"[^"]+"[\s\S]*?\}/gi, '')
    .trim();
};

export const detectLanguage = (text) => {
  if (/[\u0590-\u05FF]/.test(text)) return 'he';
  return 'en';
};

export const getOutOfScopeReply = (userLanguage) => (
  userLanguage === 'he'
    ? 'אני עוזר רק בנושאי בנקאות. אפשר לשאול על יתרה, העברות, סטטוס חשבון, או לבקש פתיחת חלון שיחת וידאו/העברה.'
    : 'I can help only with banking topics. Ask about balance, transfers, account status, or opening the video-call/transfer window.'
);

export const appendHistory = (history, userText, assistantText) => (
  [
    ...history,
    { role: 'user', content: userText },
    { role: 'assistant', content: assistantText }
  ].slice(-MAX_HISTORY)
);

export const createReplyPayload = ({
  history,
  userText,
  reply,
  transferState = null,
  action = null
}) => ({
  reply,
  nextHistory: appendHistory(history, userText, reply),
  nextTransferState: transferState,
  action
});
