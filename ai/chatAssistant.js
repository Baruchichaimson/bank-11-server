import {
  OPENAI_MODEL,
  hasOpenAiKey,
  openai
} from './openaiClient.js';

import { bankTools, executeBankTool } from './bankingTools.js';
import { runTransferGraph } from './transferGraph.js';
import { TRANSFER_PHASE } from './transferState.js';
import { runBankingGraph } from './bankingGraph.js';

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

const appendHistory = (history, userText, assistantText) => (
  [
    ...history,
    { role: 'user', content: userText },
    { role: 'assistant', content: assistantText }
  ].slice(-MAX_HISTORY)
);

const createReplyPayload = ({
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

const ROUTING_TELEMETRY = {
  llm_router: 0,
  transfer_graph: 0,
  tool_call_model: 0,
  safe_chat_fallback: 0
};

const recordRoutingDecision = (path) => {
  const key = String(path || '').trim();
  if (!key) return;
  ROUTING_TELEMETRY[key] = (ROUTING_TELEMETRY[key] || 0) + 1;
  if (process.env.ASSISTANT_ROUTING_DEBUG === 'true') {
    console.log(`[assistant-routing] ${key}`, ROUTING_TELEMETRY);
  }
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

const extractEmailToken = (text) => {
  const value = String(text || '').toLowerCase();
  const match = value.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0].trim() : '';
};

const extractAmountToken = (text) => {
  const raw = String(text || '').replace(/,/g, '.');
  const explicitMatch = raw.match(/(?:\bamount\b|סכום)\s*[:=]?\s*(\d+(?:\.\d{1,2})?)/i);
  const standaloneNumbers = [...raw.matchAll(/(^|[^a-z0-9.])(\d+(?:\.\d{1,2})?)(?=$|[^a-z0-9.])/gi)];
  const token = explicitMatch?.[1] || standaloneNumbers.at(-1)?.[2];
  if (!token) return null;
  const amount = Number(token);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
};

const hasStructuredTransferPayload = (text) => (
  Boolean(extractEmailToken(text)) && Number.isFinite(extractAmountToken(text))
);

const inferHistoryFallbackAction = (text) => {
  const value = String(text || '').toLowerCase();
  const range = {};
  const betweenMatch = value.match(/(?:between|בין)\s+(.+?)\s+(?:and|עד|לבין|to)\s+(.+)$/i);
  if (betweenMatch) {
    range.from = betweenMatch[1].trim();
    range.to = betweenMatch[2].trim();
  } else {
    if (value.includes('last month') || value.includes('חודש שעבר') || value.includes('חודש קודם')) {
      range.from = 'last month';
    } else if (value.includes('this month') || value.includes('החודש')) {
      range.from = 'this month';
    } else if (value.includes('last 30 days') || value.includes('30 יום')) {
      range.from = 'last 30 days';
    }
  }

  const limitMatch = value.match(/(?:^|\s)(\d{1,3})(?:\s+)?(?:transfers|העברות|העברה)/i);
  const limit = limitMatch ? Math.min(Math.max(Number(limitMatch[1]), 1), 100) : null;

  const asksCount = (
    value.includes('how many transfers') ||
    value.includes('count transfers') ||
    value.includes('כמה העברות')
  );
  if (asksCount) {
    return { type: 'tool', name: 'count_transfers', args: { ...range } };
  }

  const asksLast = value.includes('last transfer') || value.includes('העברה אחרונה');
  if (asksLast) {
    if (range.from) {
      return { type: 'tool', name: 'get_recent_transfers', args: { ...range, limit: 1 } };
    }
    return { type: 'tool', name: 'get_last_transfer', args: {} };
  }

  const asksHistory = (
    value.includes('recent transfers') ||
    value.includes('transfer history') ||
    value.includes('העברות אחרונות') ||
    value.includes('היסטור')
  );
  if (asksHistory || limit || range.from || range.to) {
    return {
      type: 'tool',
      name: 'get_recent_transfers',
      args: { ...range, ...(limit ? { limit } : {}) }
    };
  }

  return null;
};

const getWindowToolReply = (toolName, userLanguage) => {
  if (toolName === 'open_video_call_window') {
    return userLanguage === 'he'
      ? 'פתחתי עבורך את חלון שיחת הווידאו.'
      : 'I opened the video call window for you.';
  }
  if (toolName === 'open_money_transfer_window') {
    return userLanguage === 'he'
      ? 'פתחתי עבורך טופס העברה קצר בתוך הצ׳אט.'
      : 'I opened a quick transfer form in the chat.';
  }
  return '';
};

const getWindowToolAction = (toolName, toolResult) => {
  if (toolName === 'open_video_call_window') return toolResult?.action || 'open_video_call';
  if (toolName === 'open_money_transfer_window') return 'open_money_transfer_inline';
  return null;
};

const TOOL_ROUTER_ALLOWED_NAMES = new Set(
  (bankTools || [])
    .map((tool) => tool?.function?.name)
    .filter(Boolean)
);

const normalizeRouterArgs = (toolName, args) => {
  const raw = args && typeof args === 'object' ? args : {};
  if (toolName === 'get_recent_transfers') {
    const normalized = {};
    if (raw.from) normalized.from = String(raw.from).trim();
    if (raw.to) normalized.to = String(raw.to).trim();
    if (raw.limit !== undefined && raw.limit !== null) {
      const limit = Number(raw.limit);
      if (Number.isFinite(limit) && limit > 0) {
        normalized.limit = Math.min(Math.max(Math.floor(limit), 1), 100);
      }
    }
    return normalized;
  }

  if (toolName === 'count_transfers') {
    const normalized = {};
    if (raw.from) normalized.from = String(raw.from).trim();
    if (raw.to) normalized.to = String(raw.to).trim();
    return normalized;
  }

  if (toolName === 'get_last_sent_transfer_to_recipient') {
    const recipientName = String(raw.recipientName || '').trim();
    return recipientName ? { recipientName } : {};
  }

  return {};
};

const routeActionFromLLM = async ({ text, history, abortSignal }) => {
  if (!hasOpenAiKey || !openai) return null;

  try {
    const response = await createChatCompletion({
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You are a strict banking action router.
Return JSON only:
{
  "actionType": "tool" | "count_complaint" | "none",
  "toolName": string | "",
  "args": object,
  "requestedCount": number | null,
  "foundCount": number | null,
  "confidence": number,
  "needsClarification": boolean
}
Allowed tool names: ${[...TOOL_ROUTER_ALLOWED_NAMES].join(', ')}.
Rules:
- Pick a tool only when the user clearly requests bank data/action.
- For follow-ups like "but I asked for 5", use actionType="count_complaint" with counts if known.
- If ambiguous or out-of-scope, return empty toolName and needsClarification=true.
- Never invent arguments not implied by the user/history.
- Confidence is 0..1.`
        },
        ...(history || []).slice(-6),
        { role: 'user', content: String(text || '') }
      ],
      response_format: { type: 'json_object' },
      abortSignal
    });

    const content = response?.choices?.[0]?.message?.content;
    const parsed = parseToolArgs(content);
    const actionType = String(parsed?.actionType || 'none').trim();
    const toolName = String(parsed?.toolName || '').trim();
    const confidence = Number(parsed?.confidence);
    const needsClarification = Boolean(parsed?.needsClarification);
    const requestedCount = Number(parsed?.requestedCount);
    const foundCount = Number(parsed?.foundCount);

    if (!Number.isFinite(confidence) || confidence < 0.65 || needsClarification) return null;

    if (actionType === 'count_complaint') {
      return {
        type: 'count_complaint',
        requestedCount: Number.isFinite(requestedCount) ? requestedCount : null,
        foundCount: Number.isFinite(foundCount) ? foundCount : null
      };
    }

    if (actionType !== 'tool') return null;
    if (!toolName || !TOOL_ROUTER_ALLOWED_NAMES.has(toolName)) return null;

    return {
      type: 'tool',
      name: toolName,
      args: normalizeRouterArgs(toolName, parsed?.args || {})
    };
  } catch {
    return null;
  }
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
  const transferPhase = transferState?.phase || TRANSFER_PHASE.IDLE;

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
  const bankingFlow = await runBankingGraph({
    userInput: trimmed,
    userLanguage,
    userId,
    transferState
  });
  if (bankingFlow.handled) {
    return createReplyPayload({
      history: shortHistory,
      userText: trimmed,
      reply: bankingFlow.reply,
      transferState: bankingFlow.nextTransferState,
      action: bankingFlow.action || null
    });
  }

  const shouldPrioritizeTransferGraph = (
    transferPhase !== TRANSFER_PHASE.IDLE ||
    hasStructuredTransferPayload(trimmed)
  );

  if (shouldPrioritizeTransferGraph) {
    const transferFlow = await runTransferGraph({
      userInput: trimmed,
      userLanguage,
      userId,
      transferState
    });

    if (transferFlow.handled) {
      recordRoutingDecision('transfer_graph');
      return createReplyPayload({
        history: shortHistory,
        userText: trimmed,
        reply: transferFlow.reply,
        transferState: transferFlow.nextTransferState,
        action: transferFlow.action || null
      });
    }
  }

  const routedAction = await routeActionFromLLM({
    text: trimmed,
    history: shortHistory,
    abortSignal
  });
  if (routedAction) {
    if (routedAction.type === 'tool' && routedAction.name === 'open_money_transfer_window' && hasStructuredTransferPayload(trimmed)) {
      // Let the transfer graph execute structured transfer payloads instead of reopening the form.
    } else {
    recordRoutingDecision('llm_router');
    if (routedAction.type === 'count_complaint') {
      const requested = routedAction.requestedCount;
      const found = routedAction.foundCount;
      const reply = userLanguage === 'he'
        ? (requested && found !== null && found < requested
            ? `בטווח הזמן שביקשת נמצאו רק ${found} העברות, לכן אין לי ${requested} להציג. אפשר להרחיב טווח זמן ואביא יותר.`
            : 'אם לא הוחזרו מספיק תוצאות, כנראה שאין מספיק העברות בטווח הזמן שנבחר. אפשר להרחיב טווח זמן.')
        : (requested && found !== null && found < requested
            ? `Only ${found} transfers were found in that range, so I cannot show ${requested}. You can widen the time range and I will fetch more.`
            : 'If fewer results were returned, there may not be enough transfers in that date range. You can widen the range.');
      return createReplyPayload({
        history: shortHistory,
        userText: trimmed,
        reply,
        transferState,
        action: null
      });
    }

    const result = await executeBankTool({
      name: routedAction.name,
      args: routedAction.args || {},
      userId
    });

    if (routedAction.name === 'open_video_call_window' || routedAction.name === 'open_money_transfer_window') {
      const reply = getWindowToolReply(routedAction.name, userLanguage);
      return createReplyPayload({
        history: shortHistory,
        userText: trimmed,
        reply,
        transferState,
        action: getWindowToolAction(routedAction.name, result)
      });
    }

    const reply = formatFinancialResponse(routedAction.name, result, userLanguage);
    return createReplyPayload({
      history: shortHistory,
      userText: trimmed,
      reply,
      transferState,
      action: null
    });
    }
  }

  const historyFallback = inferHistoryFallbackAction(trimmed);
  if (historyFallback) {
    const result = await executeBankTool({
      name: historyFallback.name,
      args: historyFallback.args || {},
      userId
    });
    const reply = formatFinancialResponse(historyFallback.name, result, userLanguage);
    return createReplyPayload({
      history: shortHistory,
      userText: trimmed,
      reply,
      transferState,
      action: null
    });
  }

  const transferFlow = await runTransferGraph({
    userInput: trimmed,
    userLanguage,
    userId,
    transferState
  });

  if (transferFlow.handled) {
    recordRoutingDecision('transfer_graph');
    return createReplyPayload({
      history: history.slice(-MAX_HISTORY),
      userText: trimmed,
      reply: transferFlow.reply,
      transferState: transferFlow.nextTransferState,
      action: transferFlow.action || null
    });
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
      recordRoutingDecision('tool_call_model');

      const toolCall = toolCalls[0];
      const toolName = toolCall.function.name;
      const toolArgs = parseToolArgs(toolCall.function.arguments);

      const result = await executeBankTool({
        name: toolName,
        args: toolArgs,
        userId
      });

      if (toolName === 'open_video_call_window' || toolName === 'open_money_transfer_window') {
        const reply = getWindowToolReply(toolName, userLanguage);
        return createReplyPayload({
          history: shortHistory,
          userText: trimmed,
          reply,
          transferState,
          action: getWindowToolAction(toolName, result)
        });
      }

      const reply = formatFinancialResponse(toolName, result, userLanguage);

      return createReplyPayload({
        history: shortHistory,
        userText: trimmed,
        reply,
        transferState,
        action: null
      });
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

    // Safety lock: for banking queries, never allow free-form factual answers
    // without a backend tool result. This prevents hallucinated people/amounts.
    if (isLikelyBankingQuery(trimmed)) {
      safeReply = userLanguage === 'he'
        ? 'כדי לתת תשובה מדויקת ובטוחה, צריך שאזהה בקשה ברורה לנתוני חשבון/העברות. נסח בבקשה כך: "מה ההעברה האחרונה שלי בחודש שעבר?" או "תביא 5 העברות אחרונות מהחודש הקודם".'
        : 'To provide a precise and safe answer, I need a clear account/transfers data request. Try: "What was my last transfer last month?" or "Show 5 recent transfers from last month."';
    }

    if (!safeReply && isLikelyBankingQuery(trimmed)) {
      safeReply = userLanguage === 'he'
        ? 'לא הצלחתי להבין את הבקשה עד הסוף. אפשר לנסח מחדש בקצרה, למשל: "כמה העברות ביצעתי בחודש האחרון?"'
        : 'I could not fully parse that request. Please rephrase briefly, for example: "How many transfers did I make in the last month?"';
    }
    recordRoutingDecision('safe_chat_fallback');

    return createReplyPayload({
      history: shortHistory,
      userText: trimmed,
      reply: safeReply,
      transferState,
      action: null
    });

  } catch (err) {
    const fallbackReply = userLanguage === 'he'
      ? 'יש כרגע תקלה זמנית בעוזר. נסה שוב בעוד כמה שניות.'
      : 'The assistant is temporarily unavailable. Please try again in a few seconds.';
    return createReplyPayload({
      history: shortHistory,
      userText: trimmed,
      reply: fallbackReply,
      transferState,
      action: null
    });
  }
};
