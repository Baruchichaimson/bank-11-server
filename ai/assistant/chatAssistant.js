import {
  OPENAI_MODEL,
  hasOpenAiKey,
  openai
} from './openaiClient.js';

import { runBankingGraph } from '../graph/bankingGraph.js';
import { createBusinessServices } from '../services/businessServices.js';
import {
  MAX_HISTORY,
  detectLanguage
} from './shared.js';
import { createReplyPayload } from './responseWrappers.js';

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
  userEmail = null,
  history = [],
  transferState = null,
  transferPayload = null,
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
  const services = createBusinessServices();

  try {
    return await runBankingGraph({
      userInput: trimmed,
      userId,
      userEmail,
      history: shortHistory,
      transferState,
      transferPayload,
      createChatCompletion: Boolean(hasOpenAiKey && openai) ? createChatCompletion : null,
      services,
      abortSignal
    });
  } catch (err) {
    const fallbackReply = userLanguage === 'he'
      ? 'יש כרגע תקלה זמנית בעוזר. נסה שוב בעוד כמה שניות.'
      : 'The assistant is temporarily unavailable. Please try again in a few seconds.';
    return createReplyPayload({ history: shortHistory, userText: trimmed, reply: fallbackReply, transferState, action: null });
  }
};
