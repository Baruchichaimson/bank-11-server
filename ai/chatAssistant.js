import {
  OPENAI_MODEL,
  hasOpenAiKey,
  openai
} from './openaiClient.js';

import { bankTools, executeBankTool } from './bankingTools.js';

const MAX_HISTORY = 12;

/* =================================
   System Prompt – Tool Detection
================================= */

const TOOL_SYSTEM_PROMPT = `
You are a secure banking assistant.

Rules:
- You support banking topics only.
- For any request to call a representative or start a video call -> call tool: open_video_call_window.
- For any request to make/send/perform a transfer -> call tool: open_money_transfer_window.
- For balance, transfers history, account status or identity -> call the relevant banking data tool.
- Never invent financial or identity information.
- If the user asks anything unrelated to banking, politely refuse and redirect to supported banking actions.
- Keep replies short and practical.
`.trim();

/* =================================
   Utilities
================================= */

const parseToolArgs = (raw) => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const createChatCompletion = async (payload) => {
  const { abortSignal, ...rest } = payload || {};
  return openai.chat.completions.create(
    {
      model: OPENAI_MODEL,
      ...rest
    },
    abortSignal ? { signal: abortSignal } : undefined
  );
};

const sanitizeAssistantText = (text) => {
  return String(text || '')
    .replace(/<function[\s\S]*$/gi, '')
    .replace(/<\/?function[^>]*>/gi, '')
    .replace(/\{[\s\S]*?"name"\s*:\s*"[^"]+"[\s\S]*?\}/gi, '')
    .trim();
};

const getFriendlyErrorReply = (message, userLanguage) => {
  const normalized = String(message || '').toLowerCase().trim();

  if (
    normalized.includes('unauthorized') ||
    normalized.includes('not authorized')
  ) {
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

  if (
    normalized.includes('unable to retrieve data') ||
    normalized.includes('failed') ||
    normalized.includes('error')
  ) {
    return userLanguage === 'he'
      ? 'אירעה תקלה זמנית בשליפת הנתונים. נסה שוב בעוד רגע.'
      : 'There was a temporary issue retrieving your data. Please try again shortly.';
  }

  return '';
};

const containsToolLeak = (text) => {
  const value = String(text || '').toLowerCase();
  return (
    value.includes('function') ||
    value.includes('tool') ||
    value.includes('get_balance') ||
    value.includes('get_user_identity') ||
    value.includes('count_transfers') ||
    value.includes('get_last_transfer') ||
    value.includes('get_recent_transfers')
  );
};

const getOutOfScopeReply = (userLanguage) => (
  userLanguage === 'he'
    ? 'אני עוזר רק בנושאי בנקאות. אפשר לשאול על יתרה, העברות, סטטוס חשבון, או לבקש פתיחת חלון שיחת וידאו/העברה.'
    : 'I can help only with banking topics. Ask about balance, transfers, account status, or opening the video-call/transfer window.'
);

const formatDateForUser = (isoString, userLanguage) => {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString(userLanguage === 'he' ? 'he-IL' : 'en-US');
};

/* =================================
   Backend Formatting (Fast & Safe)
================================= */

const formatFinancialResponse = (toolName, result, userLanguage) => {

  if (!result || result.found === false) {
    if (String(result?.message || '').toLowerCase().includes('invalid date range')) {
      return userLanguage === 'he'
        ? 'לא הצלחתי להבין את טווח התאריכים. נסה למשל: "3 העברות אחרונות בחודש האחרון".'
        : 'I could not parse the date range. Try: "3 latest transfers in the last month".';
    }
    return (
      getFriendlyErrorReply(result?.message, userLanguage) ||
      (userLanguage === 'he'
        ? 'לא הצלחתי לשלוף את הנתונים כרגע. נסה שוב בעוד רגע.'
        : 'I could not retrieve your data right now. Please try again shortly.')
    );
  }

  // Hebrew
  if (userLanguage === 'he') {

    if (toolName === 'get_balance') {
      return `היתרה הנוכחית שלך היא ${result.balance} ${result.currency}. סטטוס החשבון הוא ${result.status}.`;
    }

    if (toolName === 'get_user_identity') {
      return `שמך הוא ${result.firstName} ${result.lastName}. כתובת האימייל שלך היא ${result.email}.`;
    }

    if (toolName === 'count_transfers') {
      return `ביצעת ${result.count} העברות בין ${result.from} ל־${result.to}.`;
    }

    if (toolName === 'get_last_transfer') {
      return `ההעברה האחרונה הייתה ${result.amount} ILS\nשולח: ${result.fromEmail}\nמקבל: ${result.toEmail}\nתאריך: ${formatDateForUser(result.createdAt, userLanguage)}.`;
    }

    if (toolName === 'get_last_sent_transfer_to_recipient') {
      if (!result.items?.length) {
        return 'לא נמצאו העברות עם איש הקשר שביקשת.';
      }

      const rows = result.items
        .map(
          (tx, index) =>
            `העברה ${index + 1}\n--------------------\nסכום: ${tx.amount} ILS\nשולח: ${tx.fromEmail}\nמקבל: ${tx.toEmail}\nתאריך: ${formatDateForUser(tx.createdAt, userLanguage)}`
        )
        .join('\n\n\n');

      return `מצאתי ${result.items.length} העברות דו־כיווניות עם "${result.recipientName}" (גם ששלחת וגם שקיבלת):\n\n${rows}`;
    }

    if (toolName === 'get_recent_transfers') {
      if (!result.items?.length) {
        return 'לא נמצאו העברות בטווח התאריכים שביקשת.';
      }

      const rows = result.items
        .map(
          (tx, index) =>
            `העברה ${index + 1}\n--------------------\nסכום: ${tx.amount} ILS\nשולח: ${tx.fromEmail}\nמקבל: ${tx.toEmail}\nתאריך: ${formatDateForUser(tx.createdAt, userLanguage)}`
        )
        .join('\n\n\n');

      return `מצאתי עבורך ${result.items.length} העברות אחרונות בטווח שביקשת:\n\n${rows}`;
    }
  }

  // Default English
  if (toolName === 'get_balance') {
    return `Your current balance is ${result.balance} ${result.currency}. Account status is ${result.status}.`;
  }

  if (toolName === 'get_user_identity') {
    return `Your name is ${result.firstName} ${result.lastName}. Your email is ${result.email}.`;
  }

  if (toolName === 'count_transfers') {
    return `You made ${result.count} transfers between ${result.from} and ${result.to}.`;
  }

  if (toolName === 'get_last_transfer') {
    return `Your latest transfer was ${result.amount} ILS\nFrom: ${result.fromEmail}\nTo: ${result.toEmail}\nDate: ${formatDateForUser(result.createdAt, userLanguage)}.`;
  }

  if (toolName === 'get_last_sent_transfer_to_recipient') {
    if (!result.items?.length) {
      return 'No transfers were found with that contact.';
    }

    const rows = result.items
      .map(
        (tx, index) =>
          `Transfer ${index + 1}\n--------------------\nAmount: ${tx.amount} ILS\nFrom: ${tx.fromEmail}\nTo: ${tx.toEmail}\nDate: ${formatDateForUser(tx.createdAt, userLanguage)}`
      )
      .join('\n\n\n');

    return `I found ${result.items.length} bidirectional transfers with "${result.recipientName}" (both sent and received):\n\n${rows}`;
  }

  if (toolName === 'get_recent_transfers') {
    if (!result.items?.length) {
      return 'No transfers were found in the requested date range.';
    }

    const rows = result.items
      .map(
        (tx, index) =>
          `Transfer ${index + 1}\n--------------------\nAmount: ${tx.amount} ILS\nFrom: ${tx.fromEmail}\nTo: ${tx.toEmail}\nDate: ${formatDateForUser(tx.createdAt, userLanguage)}`
      )
      .join('\n\n\n');

    return `I found ${result.items.length} recent transfers in your requested range:\n\n${rows}`;
  }

  return 'Data retrieved successfully.';
};

/* =================================
   Detect User Language (Simple)
================================= */

const detectLanguage = (text) => {
  if (/[\u0590-\u05FF]/.test(text)) return 'he';
  return 'en';
};

/* =================================
   Agent Core
================================= */

export const generateAssistantReply = async ({
  userInput,
  userId,
  history = [],
  abortSignal
}) => {

  const trimmed = String(userInput || '').trim();
  const userLanguage = detectLanguage(trimmed);

  if (!trimmed) {
    return {
      reply: userLanguage === 'he'
        ? 'אנא כתוב הודעה כדי שאוכל לעזור.'
        : 'Please type a message so I can help.',
      nextHistory: history,
      action: null
    };
  }

  if (!hasOpenAiKey || !openai) {
    return {
      reply: 'AI service is unavailable.',
      nextHistory: history,
      action: null
    };
  }

  const shortHistory = history.slice(-MAX_HISTORY);

  const detectionMessages = [
    { role: 'system', content: TOOL_SYSTEM_PROMPT },
    ...shortHistory,
    { role: 'user', content: trimmed }
  ];

  try {

    const first = await createChatCompletion({
      temperature: 0,
      messages: detectionMessages,
      tools: bankTools,
      tool_choice: 'auto',
      abortSignal
    });

    const firstMessage = first.choices?.[0]?.message;
    const toolCalls = firstMessage?.tool_calls || [];

    /* ==========================
       If Financial Tool → Backend
    ========================== */

    if (toolCalls.length > 0) {

      const toolCall = toolCalls[0];
      const toolName = toolCall.function.name;
      const toolArgs = parseToolArgs(toolCall.function.arguments);

      const result = await executeBankTool({
        name: toolName,
        args: toolArgs,
        userId
      });

      if (toolName === 'open_video_call_window') {
        const reply = userLanguage === 'he'
          ? 'פתחתי עבורך את חלון שיחת הווידאו.'
          : 'I opened the video call window for you.';
        return {
          reply,
          nextHistory: [
            ...shortHistory,
            { role: 'user', content: trimmed },
            { role: 'assistant', content: reply }
          ].slice(-MAX_HISTORY),
          action: result?.action || 'open_video_call'
        };
      }

      if (toolName === 'open_money_transfer_window') {
        const reply = userLanguage === 'he'
          ? 'פתחתי עבורך את חלון ביצוע ההעברה.'
          : 'I opened the money transfer window for you.';
        return {
          reply,
          nextHistory: [
            ...shortHistory,
            { role: 'user', content: trimmed },
            { role: 'assistant', content: reply }
          ].slice(-MAX_HISTORY),
          action: result?.action || 'open_money_transfer'
        };
      }

      const reply = formatFinancialResponse(toolName, result, userLanguage);

      return {
        reply,
        nextHistory: [
          ...shortHistory,
          { role: 'user', content: trimmed },
          { role: 'assistant', content: reply }
        ].slice(-MAX_HISTORY),
        action: null
      };
    }

    /* ==========================
       Otherwise → Normal LLM Chat
    ========================== */

    const normalReply =
      sanitizeAssistantText(firstMessage?.content) ||
      getOutOfScopeReply(userLanguage);

    const safeReply = containsToolLeak(normalReply)
      ? getOutOfScopeReply(userLanguage)
      : normalReply;

    return {
      reply: safeReply,
      nextHistory: [
        ...shortHistory,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: safeReply }
      ].slice(-MAX_HISTORY),
      action: null
    };

  } catch (err) {
    throw new Error(`Assistant failed: ${String(err.message || err)}`);
  }
};
