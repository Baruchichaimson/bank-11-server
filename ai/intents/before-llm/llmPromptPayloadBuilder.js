const MAX_CONTEXT_MESSAGES = 6;
const MAX_CONTEXT_CHARS = 700;
export const DEFAULT_ASSISTANT_TIME_ZONE = 'Asia/Jerusalem';

const normalizeHistoryRole = (role) => (role === 'assistant' ? 'assistant' : 'user');

export const sanitizeHistoryForPrompt = (history = []) => {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((item) => ({
      role: normalizeHistoryRole(item?.role),
      content: String(item?.content || '').trim().slice(0, MAX_CONTEXT_CHARS)
    }))
    .filter((item) => item.content);
};

export const getCurrentDateForPrompt = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DEFAULT_ASSISTANT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
};

export const buildUserPromptPayload = ({ userInput, history }) => ({
  currentDate: getCurrentDateForPrompt(),
  timeZone: DEFAULT_ASSISTANT_TIME_ZONE,
  currentUserMessage: String(userInput || '').trim(),
  recentConversation: sanitizeHistoryForPrompt(history)
});
