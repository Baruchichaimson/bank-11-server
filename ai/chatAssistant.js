// import {
//   OPENAI_MODEL,
//   OPENAI_FALLBACK_MODEL,
//   hasOpenAiKey,
//   openai
// } from './openaiClient.js';

// import { bankTools, executeBankTool } from './bankingTools.js';

// const MAX_HISTORY = 12;

// /* =================================
//    System Prompt – Tool Detection
// ================================= */

// const TOOL_SYSTEM_PROMPT = `
// You are a secure banking assistant.

// Rules:
// - For ANY question about balance, transfers, account status or identity → you MUST call a tool.
// - Never invent financial or identity information.
// - Use official function calling.
// - If it is general conversation → respond normally.
// - Be polite and natural.
// `.trim();

// /* =================================
//    Utilities
// ================================= */

// const parseToolArgs = (raw) => {
//   if (!raw) return {};
//   try {
//     return JSON.parse(raw);
//   } catch {
//     return {};
//   }
// };

// const createChatCompletion = async (payload) => {
//   const { abortSignal, ...rest } = payload || {};
//   return openai.chat.completions.create(
//     {
//       model: OPENAI_MODEL,
//       ...rest
//     },
//     abortSignal ? { signal: abortSignal } : undefined
//   );
// };

// const isVideoCallIntent = (text) => {
//   const normalized = String(text || '').toLowerCase();
//   return (
//     normalized.includes('video call') ||
//     normalized.includes('start call') ||
//     normalized.includes('make a call') ||
//     normalized.includes('שיחת וידיאו') ||
//     normalized.includes('שיחת וידאו') ||
//     normalized.includes('שיחת וידיו') ||
//     normalized.includes('שיחת וידאו')
//   );
// };

// const isMoneyTransferIntent = (text) => {
//   const value = String(text || '').toLowerCase();
//   const asksToTransfer =
//     value.includes('transfer money') ||
//     value.includes('send money') ||
//     value.includes('make transfer') ||
//     value.includes('new transfer') ||
//     value.includes('בצע העברה') ||
//     value.includes('להעביר') ||
//     value.includes('תעביר') ||
//     value.includes('שלח כסף') ||
//     value.includes('לשלוח כסף') ||
//     value.includes('איך שולחים כסף') ||
//     value.includes('איך אני שולח כסף') ||
//     value.includes('איך שולחת כסף') ||
//     value.includes('איך שולחים') ||
//     value.includes('שליחת כסף');

//   const isHistoryQuestion =
//     value.includes('last') ||
//     value.includes('recent') ||
//     value.includes('latest') ||
//     value.includes('history') ||
//     value.includes('אחרונ') ||
//     value.includes('היסטור');

//   return asksToTransfer && !isHistoryQuestion;
// };

// const hasTransferKeyword = (text) => {
//   const value = String(text || '').toLowerCase();
//   return (
//     value.includes('transfer') ||
//     value.includes('money') ||
//     value.includes('העברה') ||
//     value.includes('להעביר') ||
//     value.includes('כסף')
//   );
// };

// const isTransferHowIntent = (text, history = []) => {
//   const value = String(text || '').toLowerCase().trim();
//   const asksHow =
//     value.includes('how to') ||
//     value.includes('how do i') ||
//     value.includes('how can i send money') ||
//     value.includes('איך מבצעים') ||
//     value.includes('איך לבצע') ||
//     value.includes('איך ניתן לבצע') ||
//     value.includes('איך שולחים כסף') ||
//     value.includes('איך אני שולח כסף') ||
//     value.includes('איך שולחים') ||
//     value === 'איך מבצעים?' ||
//     value === 'איך מבצעים' ||
//     value === 'איך שולחים?' ||
//     value === 'איך שולחים';

//   if (!asksHow) return false;
//   if (hasTransferKeyword(value)) return true;

//   // Support short follow-up questions like "איך מבצעים?" after transfer-related context.
//   const recentUserTexts = history
//     .filter((item) => item?.role === 'user')
//     .slice(-3)
//     .map((item) => item?.content || '');

//   return recentUserTexts.some(hasTransferKeyword);
// };

// const sanitizeAssistantText = (text) => {
//   return String(text || '')
//     .replace(/<function[\s\S]*$/gi, '')
//     .replace(/<\/?function[^>]*>/gi, '')
//     .replace(/\{[\s\S]*?"name"\s*:\s*"[^"]+"[\s\S]*?\}/gi, '')
//     .trim();
// };

// const getFriendlyErrorReply = (message, userLanguage) => {
//   const normalized = String(message || '').toLowerCase().trim();

//   if (
//     normalized.includes('unauthorized') ||
//     normalized.includes('not authorized')
//   ) {
//     return userLanguage === 'he'
//       ? 'כדי לעזור עם נתוני החשבון שלך צריך להתחבר מחדש. אפשר לנסות להתנתק ולהתחבר שוב.'
//       : 'To access your account details, please sign in again and try once more.';
//   }

//   if (normalized.includes('account not found')) {
//     return userLanguage === 'he'
//       ? 'לא הצלחתי למצוא חשבון פעיל עבור המשתמש שלך. אפשר לפנות לתמיכה כדי לבדוק את זה.'
//       : 'I could not find an active account for your user. Please contact support to review this.';
//   }

//   if (normalized.includes('user not found')) {
//     return userLanguage === 'he'
//       ? 'לא הצלחתי לאמת את פרטי המשתמש שלך כרגע. נסה שוב בעוד רגע.'
//       : 'I could not verify your user details right now. Please try again in a moment.';
//   }

//   if (
//     normalized.includes('unable to retrieve data') ||
//     normalized.includes('failed') ||
//     normalized.includes('error')
//   ) {
//     return userLanguage === 'he'
//       ? 'אירעה תקלה זמנית בשליפת הנתונים. נסה שוב בעוד רגע.'
//       : 'There was a temporary issue retrieving your data. Please try again shortly.';
//   }

//   return '';
// };

// const containsToolLeak = (text) => {
//   const value = String(text || '').toLowerCase();
//   return (
//     value.includes('function') ||
//     value.includes('tool') ||
//     value.includes('get_balance') ||
//     value.includes('get_user_identity') ||
//     value.includes('count_transfers') ||
//     value.includes('get_last_transfer') ||
//     value.includes('get_recent_transfers')
//   );
// };

// const getRequestedTransferCount = (text) => {
//   const value = String(text || '').toLowerCase();
//   const countMatch = value.match(/\b(\d{1,2})\b/);
//   const requested = countMatch ? Number(countMatch[1]) : null;
//   if (!requested || requested < 1) return null;
//   return Math.min(requested, 20);
// };

// const isRecentTransfersIntent = (text) => {
//   const value = String(text || '').toLowerCase();
//   const hasTransferWord =
//     value.includes('transfer') ||
//     value.includes('transfers') ||
//     value.includes('transaction') ||
//     value.includes('transactions') ||
//     value.includes('העברה') ||
//     value.includes('העברות') ||
//     value.includes('טרנזקציה') ||
//     value.includes('טרנזקציות');

//   if (!hasTransferWord) return false;
//   const isCountQuestion =
//     value.includes('כמה ') ||
//     value.startsWith('כמה') ||
//     value.includes('how many');

//   const asksForCountedList = /\b\d{1,2}\b/.test(value) && (
//     value.includes('מה הם') ||
//     value.includes('תציג') ||
//     value.includes('show') ||
//     value.includes('list') ||
//     value.includes('give me')
//   );

//   const asksForMonthRange =
//     value.includes('בחודש הנוכחי') ||
//     value.includes('חודש נוכחי') ||
//     value.includes('בחודש הזה') ||
//     value.includes('החודש') ||
//     value.includes('בחודש הקודם') ||
//     value.includes('בחודש קודם') ||
//     value.includes('חודש קודם') ||
//     value.includes('last month') ||
//     value.includes('current month') ||
//     value.includes('this month');

//   return (
//     !isCountQuestion && (
//     asksForCountedList ||
//     asksForMonthRange ||
//     value.includes('last') ||
//     value.includes('recent') ||
//     value.includes('latest') ||
//     value.includes('אחרונ') ||
//     value.includes('recent')
//     )
//   );
// };

// const inferDateRangeFromText = (text) => {
//   const value = String(text || '').toLowerCase();
//   if (
//     value.includes('last month') ||
//     value.includes('בחודש האחרון') ||
//     value.includes('חודש אחרון') ||
//     value.includes('בחודש קודם') ||
//     value.includes('בחודש הקודם') ||
//     value.includes('חודש קודם') ||
//     value.includes('previous month')
//   ) {
//     return { from: 'last month' };
//   }

//   if (
//     value.includes('current month') ||
//     value.includes('this month') ||
//     value.includes('בחודש הנוכחי') ||
//     value.includes('חודש נוכחי') ||
//     value.includes('החודש') ||
//     value.includes('בחודש הזה')
//   ) {
//     return { from: 'this month' };
//   }

//   if (
//     value.includes('last 30 day') ||
//     value.includes('30 days') ||
//     value.includes('30 יום')
//   ) {
//     return { from: 'last 30 days' };
//   }

//   return {};
// };

// const formatDateForUser = (isoString, userLanguage) => {
//   if (!isoString) return '';
//   const d = new Date(isoString);
//   if (Number.isNaN(d.getTime())) return isoString;
//   return d.toLocaleString(userLanguage === 'he' ? 'he-IL' : 'en-US');
// };

// /* =================================
//    Backend Formatting (Fast & Safe)
// ================================= */

// const formatFinancialResponse = (toolName, result, userLanguage) => {

//   if (!result || result.found === false) {
//     if (String(result?.message || '').toLowerCase().includes('invalid date range')) {
//       return userLanguage === 'he'
//         ? 'לא הצלחתי להבין את טווח התאריכים. נסה למשל: "3 העברות אחרונות בחודש האחרון".'
//         : 'I could not parse the date range. Try: "3 latest transfers in the last month".';
//     }
//     return (
//       getFriendlyErrorReply(result?.message, userLanguage) ||
//       (userLanguage === 'he'
//         ? 'לא הצלחתי לשלוף את הנתונים כרגע. נסה שוב בעוד רגע.'
//         : 'I could not retrieve your data right now. Please try again shortly.')
//     );
//   }

//   // Hebrew
//   if (userLanguage === 'he') {

//     if (toolName === 'get_balance') {
//       return `היתרה הנוכחית שלך היא ${result.balance} ${result.currency}. סטטוס החשבון הוא ${result.status}.`;
//     }

//     if (toolName === 'get_user_identity') {
//       return `שמך הוא ${result.firstName} ${result.lastName}. כתובת האימייל שלך היא ${result.email}.`;
//     }

//     if (toolName === 'count_transfers') {
//       return `ביצעת ${result.count} העברות בין ${result.from} ל־${result.to}.`;
//     }

//     if (toolName === 'get_last_transfer') {
//       return `ההעברה האחרונה הייתה ${result.amount} ILS\nשולח: ${result.fromEmail}\nמקבל: ${result.toEmail}\nתאריך: ${formatDateForUser(result.createdAt, userLanguage)}.`;
//     }

//     if (toolName === 'get_last_sent_transfer_to_recipient') {
//       if (!result.items?.length) {
//         return 'לא נמצאו העברות עם איש הקשר שביקשת.';
//       }

//       const rows = result.items
//         .map(
//           (tx, index) =>
//             `העברה ${index + 1}\n--------------------\nסכום: ${tx.amount} ILS\nשולח: ${tx.fromEmail}\nמקבל: ${tx.toEmail}\nתאריך: ${formatDateForUser(tx.createdAt, userLanguage)}`
//         )
//         .join('\n\n\n');

//       return `מצאתי ${result.items.length} העברות דו־כיווניות עם "${result.recipientName}" (גם ששלחת וגם שקיבלת):\n\n${rows}`;
//     }

//     if (toolName === 'get_recent_transfers') {
//       if (!result.items?.length) {
//         return 'לא נמצאו העברות בטווח התאריכים שביקשת.';
//       }

//       const rows = result.items
//         .map(
//           (tx, index) =>
//             `העברה ${index + 1}\n--------------------\nסכום: ${tx.amount} ILS\nשולח: ${tx.fromEmail}\nמקבל: ${tx.toEmail}\nתאריך: ${formatDateForUser(tx.createdAt, userLanguage)}`
//         )
//         .join('\n\n\n');

//       return `מצאתי עבורך ${result.items.length} העברות אחרונות בטווח שביקשת:\n\n${rows}`;
//     }
//   }

//   // Default English
//   if (toolName === 'get_balance') {
//     return `Your current balance is ${result.balance} ${result.currency}. Account status is ${result.status}.`;
//   }

//   if (toolName === 'get_user_identity') {
//     return `Your name is ${result.firstName} ${result.lastName}. Your email is ${result.email}.`;
//   }

//   if (toolName === 'count_transfers') {
//     return `You made ${result.count} transfers between ${result.from} and ${result.to}.`;
//   }

//   if (toolName === 'get_last_transfer') {
//     return `Your latest transfer was ${result.amount} ILS\nFrom: ${result.fromEmail}\nTo: ${result.toEmail}\nDate: ${formatDateForUser(result.createdAt, userLanguage)}.`;
//   }

//   if (toolName === 'get_last_sent_transfer_to_recipient') {
//     if (!result.items?.length) {
//       return 'No transfers were found with that contact.';
//     }

//     const rows = result.items
//       .map(
//         (tx, index) =>
//           `Transfer ${index + 1}\n--------------------\nAmount: ${tx.amount} ILS\nFrom: ${tx.fromEmail}\nTo: ${tx.toEmail}\nDate: ${formatDateForUser(tx.createdAt, userLanguage)}`
//       )
//       .join('\n\n\n');

//     return `I found ${result.items.length} bidirectional transfers with "${result.recipientName}" (both sent and received):\n\n${rows}`;
//   }

//   if (toolName === 'get_recent_transfers') {
//     if (!result.items?.length) {
//       return 'No transfers were found in the requested date range.';
//     }

//     const rows = result.items
//       .map(
//         (tx, index) =>
//           `Transfer ${index + 1}\n--------------------\nAmount: ${tx.amount} ILS\nFrom: ${tx.fromEmail}\nTo: ${tx.toEmail}\nDate: ${formatDateForUser(tx.createdAt, userLanguage)}`
//       )
//       .join('\n\n\n');

//     return `I found ${result.items.length} recent transfers in your requested range:\n\n${rows}`;
//   }

//   return 'Data retrieved successfully.';
// };

// /* =================================
//    Detect User Language (Simple)
// ================================= */

// const detectLanguage = (text) => {
//   if (/[\u0590-\u05FF]/.test(text)) return 'he';
//   return 'en';
// };

// /* =================================
//    Agent Core
// ================================= */

// export const generateAssistantReply = async ({
//   userInput,
//   userId,
//   history = [],
//   abortSignal
// }) => {

//   const trimmed = String(userInput || '').trim();
//   const userLanguage = detectLanguage(trimmed);

//   if (!trimmed) {
//     return {
//       reply: userLanguage === 'he'
//         ? 'אנא כתוב הודעה כדי שאוכל לעזור.'
//         : 'Please type a message so I can help.',
//       nextHistory: history,
//       action: null
//     };
//   }

//   if (!hasOpenAiKey || !openai) {
//     return {
//       reply: 'AI service is unavailable.',
//       nextHistory: history,
//       action: null
//     };
//   }

//   if (isVideoCallIntent(trimmed)) {
//     const reply =
//       userLanguage === 'he'
//         ? 'כן. פתחתי לך את חלון שיחת הווידאו. הזן את המייל של המשתמש שתרצה להתקשר אליו.'
//         : 'Yes. I opened the video call window for you. Enter the user email to start the call.';

//     return {
//       reply,
//       nextHistory: [
//         ...history.slice(-MAX_HISTORY),
//         { role: 'user', content: trimmed },
//         { role: 'assistant', content: reply }
//       ].slice(-MAX_HISTORY),
//       action: 'open_video_call'
//     };
//   }

//   if (isTransferHowIntent(trimmed, history)) {
//     const reply =
//       userLanguage === 'he'
//         ? 'כדי לבצע העברה אני פותח לך עכשיו את מסך ההעברה. שם ממלאים מייל יעד, סכום ותיאור (אופציונלי), ולוחצים Send.'
//         : 'To make a transfer, I will open the transfer screen now. Fill recipient email, amount, optional description, then press Send.';

//     return {
//       reply,
//       nextHistory: [
//         ...history.slice(-MAX_HISTORY),
//         { role: 'user', content: trimmed },
//         { role: 'assistant', content: reply }
//       ].slice(-MAX_HISTORY),
//       action: 'open_money_transfer'
//     };
//   }

//   if (isMoneyTransferIntent(trimmed)) {
//     const reply =
//       userLanguage === 'he'
//         ? 'כן. פתחתי לך את מסך העברת הכסף. מלא מייל של יעד, סכום ותיאור אם צריך.'
//         : 'Yes. I opened the money transfer screen for you. Fill recipient email, amount and optional description.';

//     return {
//       reply,
//       nextHistory: [
//         ...history.slice(-MAX_HISTORY),
//         { role: 'user', content: trimmed },
//         { role: 'assistant', content: reply }
//       ].slice(-MAX_HISTORY),
//       action: 'open_money_transfer'
//     };
//   }

//   if (isRecentTransfersIntent(trimmed)) {
//     const inferredLimit = getRequestedTransferCount(trimmed) || 3;
//     const inferredRange = inferDateRangeFromText(trimmed);
//     const result = await executeBankTool({
//       name: 'get_recent_transfers',
//       args: {
//         limit: inferredLimit,
//         ...inferredRange
//       },
//       userId
//     });

//     const reply = formatFinancialResponse('get_recent_transfers', result, userLanguage);
//     return {
//       reply,
//       nextHistory: [
//         ...history.slice(-MAX_HISTORY),
//         { role: 'user', content: trimmed },
//         { role: 'assistant', content: reply }
//       ].slice(-MAX_HISTORY),
//       action: null
//     };
//   }

//   const shortHistory = history.slice(-MAX_HISTORY);

//   const detectionMessages = [
//     { role: 'system', content: TOOL_SYSTEM_PROMPT },
//     ...shortHistory,
//     { role: 'user', content: trimmed }
//   ];

//   try {

//     const first = await createChatCompletion({
//       temperature: 0,
//       messages: detectionMessages,
//       tools: bankTools,
//       tool_choice: 'auto',
//       abortSignal
//     });

//     const firstMessage = first.choices?.[0]?.message;
//     const toolCalls = firstMessage?.tool_calls || [];

//     /* ==========================
//        If Financial Tool → Backend
//     ========================== */

//     if (toolCalls.length > 0) {

//       const toolCall = toolCalls[0];
//       const toolName = toolCall.function.name;
//       const toolArgs = parseToolArgs(toolCall.function.arguments);

//       const result = await executeBankTool({
//         name: toolName,
//         args: toolArgs,
//         userId
//       });

//       const reply = formatFinancialResponse(
//         toolName,
//         result,
//         userLanguage
//       );

//       return {
//         reply,
//         nextHistory: [
//           ...shortHistory,
//           { role: 'user', content: trimmed },
//           { role: 'assistant', content: reply }
//         ].slice(-MAX_HISTORY),
//         action: null
//       };
//     }

//     /* ==========================
//        Otherwise → Normal LLM Chat
//     ========================== */

//     const normalReply =
//       sanitizeAssistantText(firstMessage?.content) ||
//       (userLanguage === 'he'
//         ? 'אני לא יכול לסייע בבקשה הזו.'
//         : 'I cannot assist with that request.');

//     const safeReply = containsToolLeak(normalReply)
//       ? (userLanguage === 'he'
//         ? 'כדי לעזור עם פרטי חשבון, אפשר לשאול אותי למשל "מה היתרה שלי?" ואטפל בזה עבורך.'
//         : 'For account details, ask me for example "What is my balance?" and I will handle it for you.')
//       : normalReply;

//     return {
//       reply: safeReply,
//       nextHistory: [
//         ...shortHistory,
//         { role: 'user', content: trimmed },
//         { role: 'assistant', content: safeReply }
//       ].slice(-MAX_HISTORY),
//       action: null
//     };

//   } catch (err) {
//     throw new Error(`Assistant failed: ${String(err.message || err)}`);
//   }
// };

import {
  OPENAI_MODEL,
  hasOpenAiKey,
  openai
} from './openaiClient.js';

import { bankTools, executeBankTool } from './bankingTools.js';

const MAX_HISTORY = 12;

/* ================================
   System Prompt (IMPORTANT CHANGE)
================================= */

const SYSTEM_PROMPT = `
You are a secure banking assistant.

You have tools for:
- identity
- balance
- transfers
- UI actions (open screens)

IMPORTANT:
- Always use tools for banking or UI actions.
- Never guess financial data.
- If user wants to transfer money → call open_money_transfer tool.
- If user wants video call → call open_video_call tool.
`.trim();

/* ================================
   Helpers
================================ */

const detectLanguage = (text) =>
  /[\u0590-\u05FF]/.test(text) ? 'he' : 'en';

const parseToolArgs = (raw) => {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
};

const createCompletion = async (payload) => {
  const { abortSignal, ...rest } = payload;

  return openai.chat.completions.create(
    {
      model: OPENAI_MODEL,
      ...rest
    },
    abortSignal ? { signal: abortSignal } : undefined
  );
};

const formatHistory = (history, user, assistant) => {
  return [
    ...history.slice(-MAX_HISTORY),
    { role: 'user', content: user },
    { role: 'assistant', content: assistant }
  ].slice(-MAX_HISTORY);
};

/* ================================
   MAIN
================================ */

export const generateAssistantReply = async ({
  userInput,
  userId,
  history = [],
  abortSignal
}) => {
  const trimmed = String(userInput || '').trim();
  const lang = detectLanguage(trimmed);

  if (!trimmed) {
    return {
      reply:
        lang === 'he'
          ? 'אנא כתוב הודעה.'
          : 'Please type a message.',
      nextHistory: history,
      action: null
    };
  }

  if (!hasOpenAiKey || !openai) {
    return {
      reply: 'AI unavailable',
      nextHistory: history,
      action: null
    };
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-MAX_HISTORY),
    { role: 'user', content: trimmed }
  ];

  try {
    const completion = await createCompletion({
      messages,
      tools: bankTools,
      tool_choice: 'auto',
      temperature: 0,
      abortSignal
    });

    const msg = completion.choices?.[0]?.message;
    const toolCalls = msg?.tool_calls || [];

    /* ================================
       TOOL FLOW (UNIFIED)
    ================================ */

    if (toolCalls.length > 0) {
      const call = toolCalls[0];

      const name = call.function.name;
      const args = parseToolArgs(call.function.arguments);

      const result = await executeBankTool({
        name,
        args,
        userId
      });

      /* ---------- UI ACTION ---------- */

      if (result.action) {
        return {
          reply:
            lang === 'he'
              ? 'פותח עבורך את המסך...'
              : 'Opening screen...',
          nextHistory: formatHistory(history, trimmed, ''),
          action: result.action
        };
      }

      /* ---------- DATA RESPONSE ---------- */

      return {
        reply: JSON.stringify(result, null, 2),
        nextHistory: formatHistory(history, trimmed, ''),
        action: null
      };
    }

    /* ================================
       NORMAL CHAT
    ================================ */

    const reply =
      msg?.content ||
      (lang === 'he'
        ? 'לא הבנתי את הבקשה.'
        : 'I did not understand.');

    return {
      reply,
      nextHistory: formatHistory(history, trimmed, reply),
      action: null
    };
  } catch (err) {
    throw new Error(`Assistant failed: ${err.message}`);
  }
};