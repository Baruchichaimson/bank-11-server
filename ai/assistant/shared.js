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

export const getLlmUnavailableReply = (userLanguage) => (
  userLanguage === 'he'
    ? 'מנוע ה־AI לא מוגדר כרגע, ולכן אני לא יכול להבין את הבקשה. צריך להגדיר OPENAI_API_KEY, GROQ_API_KEY או AI_PROVIDER=ollama עם OLLAMA_BASE_URL.'
    : 'The AI engine is not configured, so I cannot understand the request. Configure OPENAI_API_KEY, GROQ_API_KEY, or AI_PROVIDER=ollama with OLLAMA_BASE_URL.'
);

export const getLlmParseFailedReply = (userLanguage) => (
  userLanguage === 'he'
    ? 'קיבלתי תשובה לא תקינה ממנוע ה־AI ולא הצלחתי להבין את הבקשה. נסה שוב בעוד רגע.'
    : 'The AI engine returned an invalid parser response, so I could not understand the request. Please try again shortly.'
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
