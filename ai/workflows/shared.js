export const MAX_HISTORY = 12;

export const parseToolArgs = (raw) => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

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

const formatDateForUser = (isoString, userLanguage) => {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString(userLanguage === 'he' ? 'he-IL' : 'en-US');
};

const getFriendlyErrorReply = (message, userLanguage) => {
  const normalized = String(message || '').toLowerCase().trim();
  if (normalized.includes('unauthorized') || normalized.includes('not authorized')) {
    return userLanguage === 'he'
      ? 'כדי לעזור עם נתוני החשבון שלך צריך להתחבר מחדש. אפשר לנסות להתנתק ולהתחבר שוב.'
      : 'To access your account details, please sign in again and try once more.';
  }
  if (normalized.includes('account not found')) {
    return userLanguage === 'he'
      ? 'לא הצלחתי למצוא חשבון פעיל עבור המשתמש שלך. אפשר לפנות לתמיכה כדי לבדוק את זה.'
      : 'I could not find an active account for your user. Please contact support to review this.';
  }
  if (normalized.includes('user not found')) {
    return userLanguage === 'he'
      ? 'לא הצלחתי לאמת את פרטי המשתמש שלך כרגע. נסה שוב בעוד רגע.'
      : 'I could not verify your user details right now. Please try again in a moment.';
  }
  if (normalized.includes('unable to retrieve data') || normalized.includes('failed') || normalized.includes('error')) {
    return userLanguage === 'he'
      ? 'אירעה תקלה זמנית בשליפת הנתונים. נסה שוב בעוד רגע.'
      : 'There was a temporary issue retrieving your data. Please try again shortly.';
  }
  return '';
};

export const formatFinancialResponse = (toolName, result, userLanguage) => {
  if (!result || result.found === false) {
    if (String(result?.message || '').toLowerCase().includes('invalid date range')) {
      return userLanguage === 'he'
        ? 'לא הצלחתי להבין את טווח התאריכים. נסה למשל: "3 העברות אחרונות בחודש האחרון".'
        : 'I could not parse the date range. Try: "3 latest transfers in the last month".';
    }
    return getFriendlyErrorReply(result?.message, userLanguage) || (
      userLanguage === 'he'
        ? 'לא הצלחתי לשלוף את הנתונים כרגע. נסה שוב בעוד רגע.'
        : 'I could not retrieve your data right now. Please try again shortly.'
    );
  }

  if (userLanguage === 'he') {
    if (toolName === 'get_balance') return `היתרה הנוכחית שלך היא ${result.balance} ${result.currency}. סטטוס החשבון הוא ${result.status}.`;
    if (toolName === 'get_user_identity') return `שמך הוא ${result.firstName} ${result.lastName}. כתובת האימייל שלך היא ${result.email}.`;
    if (toolName === 'count_transfers') return `ביצעת ${result.count} העברות בין ${formatDateForUser(result.from, userLanguage)} ל־${formatDateForUser(result.to, userLanguage)}.`;
    if (toolName === 'get_last_transfer') return `ההעברה האחרונה הייתה ${result.amount} ILS\nשולח: ${result.fromEmail}\nמקבל: ${result.toEmail}\nתאריך: ${formatDateForUser(result.createdAt, userLanguage)}.`;
  }

  if (toolName === 'get_balance') return `Your current balance is ${result.balance} ${result.currency}. Account status is ${result.status}.`;
  if (toolName === 'get_user_identity') return `Your name is ${result.firstName} ${result.lastName}. Your email is ${result.email}.`;
  if (toolName === 'count_transfers') return `You made ${result.count} transfers between ${formatDateForUser(result.from, userLanguage)} and ${formatDateForUser(result.to, userLanguage)}.`;
  if (toolName === 'get_last_transfer') return `Your latest transfer was ${result.amount} ILS\nFrom: ${result.fromEmail}\nTo: ${result.toEmail}\nDate: ${formatDateForUser(result.createdAt, userLanguage)}.`;
  if (toolName === 'get_recent_transfers' && result.items?.length) return `I found ${result.items.length} recent transfers in your requested range.`;
  if (toolName === 'get_recent_transfers') return userLanguage === 'he' ? 'לא נמצאו העברות בטווח התאריכים שביקשת.' : 'No transfers were found in the requested date range.';
  return 'Data retrieved successfully.';
};

export const getWindowToolReply = (toolName, userLanguage) => {
  if (toolName === 'open_video_call_window') {
    return userLanguage === 'he' ? 'פתחתי עבורך את חלון שיחת הווידאו.' : 'I opened the video call window for you.';
  }
  if (toolName === 'open_money_transfer_window') {
    return userLanguage === 'he' ? 'פתחתי עבורך טופס העברה קצר בתוך הצ׳אט.' : 'I opened a quick transfer form in the chat.';
  }
  return '';
};

export const getWindowToolAction = (toolName, toolResult) => {
  if (toolName === 'open_video_call_window') return toolResult?.action || 'open_video_call';
  if (toolName === 'open_money_transfer_window') return 'open_money_transfer_inline';
  return null;
};

export const executeToolAndFormat = async ({
  name,
  args,
  userId,
  userLanguage,
  transferState,
  shortHistory,
  userText,
  executeBankTool
}) => {
  const result = await executeBankTool({ name, args: args || {}, userId });
  if (name === 'open_video_call_window' || name === 'open_money_transfer_window') {
    return createReplyPayload({
      history: shortHistory,
      userText,
      reply: getWindowToolReply(name, userLanguage),
      transferState,
      action: getWindowToolAction(name, result)
    });
  }
  return createReplyPayload({
    history: shortHistory,
    userText,
    reply: formatFinancialResponse(name, result, userLanguage),
    transferState,
    action: null
  });
};
