import {
  OPENAI_MODEL,
  hasOpenAiKey,
  openai
} from './openaiClient.js';

import { bankTools, executeBankTool } from './bankingTools.js';
import { runTransferGraph } from './transferGraph.js';

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
- If user asks about existing transfers/history/count/last transfer, do NOT open transfer window; use data tools.
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
      return `ביצעת ${result.count} העברות בין ${formatDateForUser(result.from, userLanguage)} ל־${formatDateForUser(result.to, userLanguage)}.`;
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
    return `You made ${result.count} transfers between ${formatDateForUser(result.from, userLanguage)} and ${formatDateForUser(result.to, userLanguage)}.`;
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

const normalizeIntentText = (text) => String(text || '')
  .toLowerCase()
  // normalize final Hebrew letters
  .replace(/ך/g, 'כ')
  .replace(/ם/g, 'מ')
  .replace(/ן/g, 'נ')
  .replace(/ף/g, 'פ')
  .replace(/ץ/g, 'צ')
  // normalize common keyboard/typo variants around "יתרה"
  .replace(/הייתרה|היתרה|יתרה|יתרת/g, 'יתרה')
  // normalize common month typos
  .replace(/חוודש|חושד|חודשד/g, 'חודש')
  .replace(/קודםה|קודמ/g, 'קודם');

const extractTransferLimit = (normalizedText) => {
  const value = String(normalizedText || '');
  const digitMatch = value.match(/(?:^|\s)(\d{1,3})(?:\s+)?(?:העברה|העברות|transfer|transfers)/);
  if (digitMatch) return Math.min(Math.max(Number(digitMatch[1]), 1), 100);

  const hebrewNumbers = [
    { token: 'אחת', value: 1 },
    { token: 'אחד', value: 1 },
    { token: 'שתי', value: 2 },
    { token: 'שתיים', value: 2 },
    { token: 'שניים', value: 2 },
    { token: 'שני', value: 2 },
    { token: 'שלוש', value: 3 },
    { token: 'ארבע', value: 4 },
    { token: 'חמש', value: 5 }
  ];
  const found = hebrewNumbers.find((x) => value.includes(`${x.token} העברות`) || value.includes(`${x.token} העברה`));
  return found ? found.value : null;
};

const inferRelativeRange = (normalizedText) => {
  const value = String(normalizedText || '');
  const betweenMatch = value.match(/בין\s+(.+?)\s+(?:לבין|ל|עד)\s+(.+)$/);
  if (betweenMatch) {
    return { from: betweenMatch[1].trim(), to: betweenMatch[2].trim() };
  }

  const fromUntilMatch = value.match(/(?:מ|מתאריך)\s+(.+?)\s+(?:עד|ועד|to)\s+(.+)$/);
  if (fromUntilMatch) {
    return { from: fromUntilMatch[1].trim(), to: fromUntilMatch[2].trim() };
  }

  if (
    value.includes('מתחילת החודש שעבר') ||
    value.includes('מתחילת חודש שעבר') ||
    value.includes('מתחילת חודש קודם')
  ) {
    return { from: 'start of last month' };
  }
  if (
    value.includes('עד סוף החודש שעבר') ||
    value.includes('עד סוף חודש שעבר') ||
    value.includes('עד סוף חודש קודם')
  ) {
    return { to: 'end of last month' };
  }
  if (value.includes('מתחילת החודש') || value.includes('מתחילת חודש') || value.includes('from start of month')) {
    return { from: 'start of this month' };
  }
  if (value.includes('עד סוף החודש') || value.includes('עד סוף חודש') || value.includes('to end of month')) {
    return { to: 'end of this month' };
  }
  if (value.includes('מתחילת השנה') || value.includes('from start of year')) {
    return { from: 'start of year' };
  }
  if (value.includes('עד סוף השנה') || value.includes('to end of year')) {
    return { to: 'end of year' };
  }

  if (
    value.includes('בחודש האחרון') ||
    value.includes('חודש אחרון') ||
    value.includes('חודש קודם') ||
    value.includes('בחודש הקודם') ||
    value.includes('חודש שעבר') ||
    value.includes('last month')
  ) {
    return { from: 'last month' };
  }
  if (
    value.includes('החודש') ||
    value.includes('בחודש הזה') ||
    value.includes('this month')
  ) {
    return { from: 'this month' };
  }
  return {};
};

const isRecentTransfersQuery = (normalizedText) => {
  const value = String(normalizedText || '');
  const mentionsTransfers = value.includes('העברה') || value.includes('העברות') || value.includes('transfer');
  const asksForList = [
    'האחרונות',
    'אחרונות',
    'recent',
    'history',
    'היסטוריה',
    'הסטוריה',
    'תביא',
    'תראה',
    'show',
    'list'
  ].some((token) => value.includes(token));

  return mentionsTransfers && asksForList;
};

const isBalanceQuery = (text) => {
  const value = normalizeIntentText(text);
  return (
    value.includes('balance') ||
    value.includes('יתרה') ||
    value.includes('כמה כסף') ||
    value.includes('מצב חשבון')
  );
};

const isLikelyBankingQuery = (text) => {
  const value = normalizeIntentText(text);
  return [
    'balance',
    'transfer',
    'transfers',
    'account',
    'status',
    'bank',
    'יתרה',
    'העברה',
    'העברות',
    'חשבון',
    'סטטוס',
    'בנק'
  ].some((token) => value.includes(token));
};

const inferToolFromUserInput = (text) => {
  const value = normalizeIntentText(text);
  const rangeArgs = inferRelativeRange(value);

  if (
    value.includes("video") ||
    value.includes("representative") ||
    value.includes("שיחת וידאו") ||
    value.includes("נציג")
  ) {
    return { name: "open_video_call_window", args: {} };
  }

  if (
    value.includes("כמה העברות") ||
    value.includes("כמה העברה") ||
    value.includes('לפני חודש כמה') ||
    value.includes("how many transfers") ||
    value.includes("count transfers")
  ) {
    return { name: "count_transfers", args: rangeArgs };
  }

  if (
    value.includes("last transfer") ||
    value.includes("העברה אחרונה")
  ) {
    return { name: "get_last_transfer", args: {} };
  }

  if (
    value.includes("recent transfers") ||
    value.includes("transfer history") ||
    value.includes("history of transfers") ||
    value.includes("העברות אחרונות") ||
    value.includes('העברה אחרונה שביצעתי') ||
    value.includes("הסטורית העברות") ||
    value.includes("היסטורית העברות") ||
    value.includes("היסטוריה של העברות") ||
    isRecentTransfersQuery(value)
  ) {
    const limit = extractTransferLimit(value);
    return { name: "get_recent_transfers", args: { ...rangeArgs, ...(limit ? { limit } : {}) } };
  }

  if (isBalanceQuery(value)) {
    return { name: "get_balance", args: {} };
  }

  if (
    value.includes("מי אני") ||
    value.includes("who am i") ||
    value.includes("my email") ||
    value.includes("האימייל שלי")
  ) {
    return { name: "get_user_identity", args: {} };
  }

  if (
    value.includes("send money") ||
    value.includes("make transfer") ||
    value.includes("new transfer") ||
    value.includes("בצע העברה") ||
    value.includes("להעביר כסף") ||
    value.includes("העברה חדשה") ||
    value.includes("שלח כסף")
  ) {
    return { name: "open_money_transfer_window", args: {} };
  }

  return null;
};

const inferHighConfidenceTool = (text) => {
  const value = normalizeIntentText(text);
  const rangeArgs = inferRelativeRange(value);

  if (
    value.includes('כמה העברות') ||
    value.includes('כמה העברה') ||
    value.includes('לפני חודש כמה') ||
    value.includes('how many transfers') ||
    value.includes('count transfers')
  ) {
    return { name: 'count_transfers', args: rangeArgs };
  }

  if (
    value.includes('last transfer') ||
    value.includes('העברה אחרונה') ||
    value.includes('תביא לי את העברה האחרונה') ||
    value.includes('תביאי לי את העברה האחרונה')
  ) {
    if (rangeArgs.from === 'last month') {
      return { name: 'get_recent_transfers', args: { from: 'last month', limit: 1 } };
    }
    return { name: 'get_last_transfer', args: {} };
  }

  if (
    value.includes('2 העברות האחרונות') ||
    value.includes('שתי העברות האחרונות') ||
    value.includes('שני העברות האחרונות') ||
    value.includes('recent transfers') ||
    value.includes('transfer history') ||
    value.includes('history of transfers') ||
    value.includes('העברות אחרונות') ||
    value.includes('הסטורית העברות') ||
    value.includes('היסטורית העברות') ||
    value.includes('היסטוריה של העברות') ||
    isRecentTransfersQuery(value)
  ) {
    const limit = extractTransferLimit(value);
    return { name: 'get_recent_transfers', args: { ...rangeArgs, ...(limit ? { limit } : {}) } };
  }

  if (isBalanceQuery(value)) {
    return { name: 'get_balance', args: {} };
  }

  return null;
};

/* =================================
   Agent Core
================================= */

export const generateAssistantReply = async ({
  userInput,
  userId,
  history = [],
  transferState = null,
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
      nextTransferState: transferState,
      action: null
    };
  }

  const shortHistory = history.slice(-MAX_HISTORY);
  const highConfidenceTool = inferHighConfidenceTool(trimmed);

  if (highConfidenceTool) {
    const result = await executeBankTool({
      name: highConfidenceTool.name,
      args: highConfidenceTool.args || {},
      userId
    });
    const reply = formatFinancialResponse(highConfidenceTool.name, result, userLanguage);
    return {
      reply,
      nextHistory: [
        ...shortHistory,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: reply }
      ].slice(-MAX_HISTORY),
      nextTransferState: transferState,
      action: null
    };
  }

  const transferFlow = await runTransferGraph({
    userInput: trimmed,
    userLanguage,
    userId,
    transferState
  });

  if (transferFlow.handled) {
    return {
      reply: transferFlow.reply,
      nextHistory: [
        ...history.slice(-MAX_HISTORY),
        { role: 'user', content: trimmed },
        { role: 'assistant', content: transferFlow.reply }
      ].slice(-MAX_HISTORY),
      nextTransferState: transferFlow.nextTransferState,
      action: transferFlow.action || null
    };
  }

  if (!hasOpenAiKey || !openai) {
    return {
      reply: 'AI service is unavailable.',
      nextHistory: history,
      nextTransferState: transferState,
      action: null
    };
  }

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
          nextTransferState: transferState,
          action: result?.action || 'open_video_call'
        };
      }

      if (toolName === 'open_money_transfer_window') {
        const reply = userLanguage === 'he'
          ? 'פתחתי עבורך טופס העברה קצר בתוך הצ׳אט.'
          : 'I opened a quick transfer form in the chat.';
        return {
          reply,
          nextHistory: [
            ...shortHistory,
            { role: 'user', content: trimmed },
            { role: 'assistant', content: reply }
          ].slice(-MAX_HISTORY),
          nextTransferState: transferState,
          action: 'open_money_transfer_inline'
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
        nextTransferState: transferState,
        action: null
      };
    }

    // Fallback: if model skipped tool-calls for a banking query, infer and execute the tool directly.
    const inferred = inferToolFromUserInput(trimmed);
    if (inferred) {
      const result = await executeBankTool({
        name: inferred.name,
        args: inferred.args,
        userId
      });

      if (inferred.name === 'open_video_call_window') {
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
          nextTransferState: transferState,
          action: result?.action || 'open_video_call'
        };
      }

      if (inferred.name === 'open_money_transfer_window') {
        const reply = userLanguage === 'he'
          ? 'פתחתי עבורך טופס העברה קצר בתוך הצ׳אט.'
          : 'I opened a quick transfer form in the chat.';
        return {
          reply,
          nextHistory: [
            ...shortHistory,
            { role: 'user', content: trimmed },
            { role: 'assistant', content: reply }
          ].slice(-MAX_HISTORY),
          nextTransferState: transferState,
          action: 'open_money_transfer_inline'
        };
      }

      const reply = formatFinancialResponse(inferred.name, result, userLanguage);
      return {
        reply,
        nextHistory: [
          ...shortHistory,
          { role: 'user', content: trimmed },
          { role: 'assistant', content: reply }
        ].slice(-MAX_HISTORY),
        nextTransferState: transferState,
        action: null
      };
    }

    /* ==========================
       Otherwise → Normal LLM Chat
    ========================== */

    const normalReply =
      sanitizeAssistantText(firstMessage?.content) ||
      getOutOfScopeReply(userLanguage);

    let safeReply = containsToolLeak(normalReply)
      ? getOutOfScopeReply(userLanguage)
      : normalReply;

    if (!safeReply && isLikelyBankingQuery(trimmed)) {
      safeReply = userLanguage === 'he'
        ? 'לא הצלחתי להבין את הבקשה עד הסוף. אפשר לנסח מחדש בקצרה, למשל: "כמה העברות ביצעתי בחודש האחרון?"'
        : 'I could not fully parse that request. Please rephrase briefly, for example: "How many transfers did I make in the last month?"';
    }

    return {
      reply: safeReply,
      nextHistory: [
        ...shortHistory,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: safeReply }
      ].slice(-MAX_HISTORY),
      nextTransferState: transferState,
      action: null
    };

  } catch (err) {
    const fallbackReply = userLanguage === 'he'
      ? 'יש כרגע תקלה זמנית בעוזר. נסה שוב בעוד כמה שניות.'
      : 'The assistant is temporarily unavailable. Please try again in a few seconds.';
    return {
      reply: fallbackReply,
      nextHistory: [
        ...shortHistory,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: fallbackReply }
      ].slice(-MAX_HISTORY),
      nextTransferState: transferState,
      action: null
    };
  }
};
