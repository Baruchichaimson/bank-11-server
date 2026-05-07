// import {
//   AI_PROVIDER,
//   OPENAI_FALLBACK_MODEL,
//   OPENAI_MODEL,
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
// - Never answer those questions directly.
// - Never invent financial or identity information.
// - Use official function calling.
// - Do NOT output JSON manually.
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

// const parseToolCallFromContent = (content) => {
//   const text = String(content || '').trim();
//   if (!text) return [];

//   try {
//     const parsed = JSON.parse(text);
//     const candidates = Array.isArray(parsed) ? parsed : [parsed];
//     const toolCalls = [];

//     for (const item of candidates) {
//       const name = String(
//         item?.name || item?.function?.name || ''
//       ).toLowerCase();

//       if (!name) continue;

//       const argsObject =
//         item?.parameters ||
//         item?.arguments ||
//         item?.args ||
//         item?.function?.arguments ||
//         {};

//       const args =
//         typeof argsObject === 'string'
//           ? parseToolArgs(argsObject)
//           : argsObject || {};

//       toolCalls.push({
//         id: `manual_${name}_${Date.now()}`,
//         type: 'function',
//         function: {
//           name,
//           arguments: JSON.stringify(args)
//         }
//       });
//     }

//     return toolCalls;
//   } catch {
//     return [];
//   }
// };

// const isModelIssue = (err) => {
//   const code = String(err?.code || err?.error?.code || '').toLowerCase();
//   const message = String(err?.message || err?.error?.message || '').toLowerCase();

//   return (
//     code.includes('model') ||
//     message.includes('model') ||
//     message.includes('does not exist')
//   );
// };

// const createChatCompletion = async (payload) => {
//   try {
//     return await openai.chat.completions.create({
//       model: OPENAI_MODEL,
//       ...payload
//     });
//   } catch (err) {
//     const hasFallback = Boolean(OPENAI_FALLBACK_MODEL);

//     if (!isModelIssue(err) || !hasFallback || OPENAI_MODEL === OPENAI_FALLBACK_MODEL) {
//       throw err;
//     }

//     return openai.chat.completions.create({
//       model: OPENAI_FALLBACK_MODEL,
//       ...payload
//     });
//   }
// };

// /* =================================
//    Agent Core
// ================================= */

// export const generateAssistantReply = async ({
//   userInput,
//   userId,
//   history = []
// }) => {

//   const trimmed = String(userInput || '').trim();

//   if (!trimmed) {
//     return {
//       reply: 'Please type a message so I can help.',
//       nextHistory: history
//     };
//   }

//   if (!hasOpenAiKey || !openai) {
//     return {
//       reply: 'AI service is currently unavailable.',
//       nextHistory: history
//     };
//   }

//   const shortHistory = history.slice(-MAX_HISTORY);

//   /* ==========================
//      Phase 1 – Tool Detection
//   ========================== */

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
//       tool_choice: 'auto'
//     });

//     const firstMessage = first.choices?.[0]?.message;

//     const toolCalls =
//       firstMessage?.tool_calls?.length > 0
//         ? firstMessage.tool_calls
//         : parseToolCallFromContent(firstMessage?.content);

//     /* ==========================
//        No Tool Needed
//     ========================== */

//     if (!toolCalls.length) {

//       const fallbackReply =
//         firstMessage?.content ||
//         'Unable to assist with that request.';

//       return {
//         reply: fallbackReply,
//         nextHistory: [
//           ...shortHistory,
//           { role: 'user', content: trimmed },
//           { role: 'assistant', content: fallbackReply }
//         ].slice(-MAX_HISTORY)
//       };
//     }

//     /* ==========================
//        Execute Tools (Once)
//     ========================== */

//     const toolResults = [];

//     for (const toolCall of toolCalls) {

//       const toolName = String(toolCall.function?.name || '').toLowerCase();
//       const toolArgs = parseToolArgs(toolCall.function?.arguments);

//       let result;

//       try {
//         result = await executeBankTool({
//           name: toolName,
//           args: toolArgs,
//           userId
//         });
//       } catch {
//         result = {
//           found: false,
//           message: `Tool execution failed for ${toolName}`
//         };
//       }

//       toolResults.push({ toolName, result });
//     }

//     /* ==========================
//        Phase 2 – Clean Multilingual Answer
//     ========================== */

//     let toolTextBlock = '';

//     for (const item of toolResults) {

//       const { toolName, result } = item;

//       if (!result || result.found === false) {
//         toolTextBlock += `Error: ${result?.message}\n`;
//         continue;
//       }

//       if (toolName === 'get_balance') {
//         toolTextBlock += `
// Balance: ${result.balance}
// Currency: ${result.currency}
// Status: ${result.status}
// `;
//       }

//       if (toolName === 'get_user_identity') {
//         toolTextBlock += `
// First name: ${result.firstName}
// Last name: ${result.lastName}
// Email: ${result.email}
// `;
//       }

//       if (toolName === 'count_transfers') {
//         toolTextBlock += `
// Transfer count: ${result.count}
// From: ${result.from}
// To: ${result.to}
// `;
//       }

//       if (toolName === 'get_last_transfer') {
//         toolTextBlock += `
// Amount: ${result.amount}
// From: ${result.fromEmail}
// To: ${result.toEmail}
// Date: ${result.createdAt}
// `;
//       }

//       if (toolName === 'get_last_sent_transfer_to_recipient') {
//         toolTextBlock += `
// Amount: ${result.amount}
// Recipient: ${result.toEmail}
// Date: ${result.createdAt}
// `;
//       }
//     }

//     const generationMessages = [
//       {
//         role: 'system',
//         content: `
// You are generating the final answer for the user.

// Rules:
// - Respond in the user's language.
// - Use ONLY the provided data.
// - Do NOT mention tools.
// - Do NOT explain your reasoning.
// - Do NOT output JSON.
// - Provide only the final answer.
// `
//       },
//       {
//         role: 'system',
//         content: `Available data:\n${toolTextBlock}`
//       },
//       { role: 'user', content: trimmed }
//     ];

//     const second = await createChatCompletion({
//       temperature: 0,
//       messages: generationMessages
//     });

//     const reply =
//       second.choices?.[0]?.message?.content ||
//       'Unable to generate a response.';

//     return {
//       reply,
//       nextHistory: [
//         ...shortHistory,
//         { role: 'user', content: trimmed },
//         { role: 'assistant', content: reply }
//       ].slice(-MAX_HISTORY)
//     };

//   } catch (err) {
//     throw new Error(`Assistant failed: ${String(err.message || err)}`);
//   }
// };
import {
  OPENAI_MODEL,
  OPENAI_FALLBACK_MODEL,
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
- For ANY question about balance, transfers, account status or identity → you MUST call a tool.
- Never invent financial or identity information.
- Use official function calling.
- If it is general conversation → respond normally.
- Be polite and natural.
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
  return openai.chat.completions.create({
    model: OPENAI_MODEL,
    ...payload
  });
};

const isVideoCallIntent = (text) => {
  const normalized = String(text || '').toLowerCase();
  return (
    normalized.includes('video call') ||
    normalized.includes('start call') ||
    normalized.includes('make a call') ||
    normalized.includes('שיחת וידיאו') ||
    normalized.includes('שיחת וידאו') ||
    normalized.includes('שיחת וידיו') ||
    normalized.includes('שיחת וידאו')
  );
};

const isMoneyTransferIntent = (text) => {
  const value = String(text || '').toLowerCase();
  const asksToTransfer =
    value.includes('transfer money') ||
    value.includes('send money') ||
    value.includes('make transfer') ||
    value.includes('new transfer') ||
    value.includes('בצע העברה') ||
    value.includes('להעביר') ||
    value.includes('תעביר') ||
    value.includes('שלח כסף') ||
    value.includes('לשלוח כסף');

  const isHistoryQuestion =
    value.includes('last') ||
    value.includes('recent') ||
    value.includes('latest') ||
    value.includes('history') ||
    value.includes('אחרונ') ||
    value.includes('היסטור');

  return asksToTransfer && !isHistoryQuestion;
};

const getRequestedTransferCount = (text) => {
  const value = String(text || '').toLowerCase();
  const countMatch = value.match(/\b(\d{1,2})\b/);
  const requested = countMatch ? Number(countMatch[1]) : null;
  if (!requested || requested < 1) return null;
  return Math.min(requested, 20);
};

const isRecentTransfersIntent = (text) => {
  const value = String(text || '').toLowerCase();
  const hasTransferWord =
    value.includes('transfer') ||
    value.includes('transfers') ||
    value.includes('transaction') ||
    value.includes('transactions') ||
    value.includes('העברה') ||
    value.includes('העברות') ||
    value.includes('טרנזקציה') ||
    value.includes('טרנזקציות');

  if (!hasTransferWord) return false;

  return (
    value.includes('last') ||
    value.includes('recent') ||
    value.includes('latest') ||
    value.includes('אחרונ') ||
    value.includes('recent')
  );
};

const inferDateRangeFromText = (text) => {
  const value = String(text || '').toLowerCase();
  if (
    value.includes('last month') ||
    value.includes('בחודש האחרון') ||
    value.includes('חודש אחרון') ||
    value.includes('בחודש קודם') ||
    value.includes('בחודש הקודם') ||
    value.includes('חודש קודם') ||
    value.includes('previous month')
  ) {
    return { from: 'last month' };
  }

  if (
    value.includes('last 30 day') ||
    value.includes('30 days') ||
    value.includes('30 יום')
  ) {
    return { from: 'last 30 days' };
  }

  return {};
};

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
    return result?.message || 'Unable to retrieve data.';
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

    if (toolName === 'get_recent_transfers') {
      if (!result.items?.length) {
        return 'לא נמצאו העברות בטווח התאריכים שביקשת.';
      }

      const rows = result.items
        .map((tx, index) =>
          `${index + 1}) סכום: ${tx.amount} ILS\nשולח: ${tx.fromEmail}\nמקבל: ${tx.toEmail}\nתאריך: ${formatDateForUser(tx.createdAt, userLanguage)}`
        )
        .join('\n\n');

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

  if (toolName === 'get_recent_transfers') {
    if (!result.items?.length) {
      return 'No transfers were found in the requested date range.';
    }

    const rows = result.items
      .map((tx, index) =>
        `${index + 1}) Amount: ${tx.amount} ILS\nFrom: ${tx.fromEmail}\nTo: ${tx.toEmail}\nDate: ${formatDateForUser(tx.createdAt, userLanguage)}`
      )
      .join('\n\n');

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
  history = []
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

  if (isVideoCallIntent(trimmed)) {
    const reply =
      userLanguage === 'he'
        ? 'כן. פתחתי לך את חלון שיחת הווידאו. הזן את המייל של המשתמש שתרצה להתקשר אליו.'
        : 'Yes. I opened the video call window for you. Enter the user email to start the call.';

    return {
      reply,
      nextHistory: [
        ...history.slice(-MAX_HISTORY),
        { role: 'user', content: trimmed },
        { role: 'assistant', content: reply }
      ].slice(-MAX_HISTORY),
      action: 'open_video_call'
    };
  }

  if (isMoneyTransferIntent(trimmed)) {
    const reply =
      userLanguage === 'he'
        ? 'כן. פתחתי לך את מסך העברת הכסף. מלא מייל של יעד, סכום ותיאור אם צריך.'
        : 'Yes. I opened the money transfer screen for you. Fill recipient email, amount and optional description.';

    return {
      reply,
      nextHistory: [
        ...history.slice(-MAX_HISTORY),
        { role: 'user', content: trimmed },
        { role: 'assistant', content: reply }
      ].slice(-MAX_HISTORY),
      action: 'open_money_transfer'
    };
  }

  if (isRecentTransfersIntent(trimmed)) {
    const inferredLimit = getRequestedTransferCount(trimmed) || 3;
    const inferredRange = inferDateRangeFromText(trimmed);
    const result = await executeBankTool({
      name: 'get_recent_transfers',
      args: {
        limit: inferredLimit,
        ...inferredRange
      },
      userId
    });

    const reply = formatFinancialResponse('get_recent_transfers', result, userLanguage);
    return {
      reply,
      nextHistory: [
        ...history.slice(-MAX_HISTORY),
        { role: 'user', content: trimmed },
        { role: 'assistant', content: reply }
      ].slice(-MAX_HISTORY),
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
      tool_choice: 'auto'
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

      const reply = formatFinancialResponse(
        toolName,
        result,
        userLanguage
      );

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
      firstMessage?.content ||
      (userLanguage === 'he'
        ? 'אני לא יכול לסייע בבקשה הזו.'
        : 'I cannot assist with that request.');

    return {
      reply: normalReply,
      nextHistory: [
        ...shortHistory,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: normalReply }
      ].slice(-MAX_HISTORY),
      action: null
    };

  } catch (err) {
    throw new Error(`Assistant failed: ${String(err.message || err)}`);
  }
};
