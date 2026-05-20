import {
  OPENAI_MODEL,
  hasOpenAiKey,
  openai
} from './openaiClient.js';

import { bankTools, executeBankTool } from './bankingTools.js';
import { runTransferGraph } from './transferGraph.js';
import {
  MAX_HISTORY,
  detectLanguage,
  isLikelyBankingQuery,
  inferToolFromUserInput,
  inferHighConfidenceTool,
  inferFollowupToolFromHistory,
  extractRequestedCountFromComplaint,
  extractFoundTransfersCountFromAssistant,
  getLastAssistantMessage
} from './workflows/legacyCompatUtils.js';
import { formatFinancialResponse } from './workflows/responseFormatting.js';
import {
  createReplyPayload,
  getWindowToolReply,
  getWindowToolAction
} from './workflows/responseWrappers.js';
import {
  sanitizeAssistantText,
  containsToolLeak,
  getOutOfScopeReply
} from './workflows/textSafety.js';

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
  const followupTool = inferFollowupToolFromHistory(trimmed, shortHistory);

  if (highConfidenceTool) {
    const result = await executeBankTool({
      name: highConfidenceTool.name,
      args: highConfidenceTool.args || {},
      userId
    });
    const reply = formatFinancialResponse(highConfidenceTool.name, result, userLanguage);
    return createReplyPayload({ history: shortHistory, userText: trimmed, reply, transferState, action: null });
  }

  if (followupTool) {
    if (followupTool.name === '__complaint_requested_count__') {
      const requested = extractRequestedCountFromComplaint(trimmed);
      const found = extractFoundTransfersCountFromAssistant(getLastAssistantMessage(shortHistory));
      const reply = userLanguage === 'he'
        ? (requested && found !== null && found < requested
            ? `בטווח הזמן שביקשת נמצאו רק ${found} העברות, לכן אין לי ${requested} להציג. אפשר להרחיב טווח זמן ואביא יותר.`
            : 'אם לא הוחזרו מספיק תוצאות, כנראה שאין מספיק העברות בטווח הזמן שנבחר. אפשר להרחיב טווח זמן.')
        : (requested && found !== null && found < requested
            ? `Only ${found} transfers were found in that range, so I cannot show ${requested}. You can widen the time range and I will fetch more.`
            : 'If fewer results were returned, there may not be enough transfers in that date range. You can widen the range.');
      return createReplyPayload({ history: shortHistory, userText: trimmed, reply, transferState, action: null });
    }

    const result = await executeBankTool({
      name: followupTool.name,
      args: followupTool.args || {},
      userId
    });
    const reply = formatFinancialResponse(followupTool.name, result, userLanguage);
    return createReplyPayload({ history: shortHistory, userText: trimmed, reply, transferState, action: null });
  }

  const transferFlow = await runTransferGraph({ userInput: trimmed, userLanguage, userId, transferState });

  if (transferFlow.handled) {
    return createReplyPayload({
      history: shortHistory,
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

    if (toolCalls.length > 0) {
      const toolCall = toolCalls[0];
      const toolName = toolCall.function.name;
      const toolArgs = parseToolArgs(toolCall.function.arguments);

      const result = await executeBankTool({ name: toolName, args: toolArgs, userId });

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
      return createReplyPayload({ history: shortHistory, userText: trimmed, reply, transferState, action: null });
    }

    const inferred = inferToolFromUserInput(trimmed);
    if (inferred) {
      const result = await executeBankTool({ name: inferred.name, args: inferred.args, userId });

      if (inferred.name === 'open_video_call_window' || inferred.name === 'open_money_transfer_window') {
        const reply = getWindowToolReply(inferred.name, userLanguage);
        return createReplyPayload({
          history: shortHistory,
          userText: trimmed,
          reply,
          transferState,
          action: getWindowToolAction(inferred.name, result)
        });
      }

      const reply = formatFinancialResponse(inferred.name, result, userLanguage);
      return createReplyPayload({ history: shortHistory, userText: trimmed, reply, transferState, action: null });
    }

    const normalReply = sanitizeAssistantText(firstMessage?.content) || getOutOfScopeReply(userLanguage);

    let safeReply = containsToolLeak(normalReply)
      ? getOutOfScopeReply(userLanguage)
      : normalReply;

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

    return createReplyPayload({ history: shortHistory, userText: trimmed, reply: safeReply, transferState, action: null });
  } catch (err) {
    const fallbackReply = userLanguage === 'he'
      ? 'יש כרגע תקלה זמנית בעוזר. נסה שוב בעוד כמה שניות.'
      : 'The assistant is temporarily unavailable. Please try again in a few seconds.';
    return createReplyPayload({ history: shortHistory, userText: trimmed, reply: fallbackReply, transferState, action: null });
  }
};
