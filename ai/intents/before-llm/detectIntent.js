import { parseQueryWithLlm, validateSemanticQuery } from '../llmSemanticParser.js';
import { normalizeTransactionSemanticQuery } from '../after-llm/transactionQueryNormalizer.js';
import { getCurrentDateForPrompt } from './llmPromptPayloadBuilder.js';

const UNKNOWN_PARSE = {
  source: 'safe_unknown',
  domain: 'unknown',
  intent: 'unknown',
  confidence: 0,
  semanticQuery: null,
  workflowContinuation: false,
  correction: null,
  transferPayload: null,
  toolName: null,
  toolArgs: {},
  isAmbiguous: false,
  ambiguityReason: null
};

const LLM_UNAVAILABLE_PARSE = {
  ...UNKNOWN_PARSE,
  source: 'llm_unavailable'
};

const LLM_PARSE_FAILED_PARSE = {
  ...UNKNOWN_PARSE,
  source: 'llm_parse_failed'
};

const normalizeUserText = (value) => String(value || '')
  .trim()
  .replace(/[־–—]/g, '-')
  .replace(/["'.,!?;:()[\]{}]/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const isTransactionCountQuestion = (userInput) => {
  const text = normalizeUserText(userInput);
  const asksCount = /(?:^|\s)כמה(?:\s|$)/.test(text)
    || /מה\s+(?:מספר|כמות)\s+ה/.test(text)
    || /how\s+many/i.test(text)
    || /\bcount\b/i.test(text)
    || /\bnumber\s+of\b/i.test(text);
  const hasTransactionNoun = /ה?העברות?|ה?העברה|ה?פעולות?|ה?פעולה|ה?טרנזקציות?|ה?טרנזקציה|transfers?|transactions?|activities|activity/i.test(text);
  return asksCount && hasTransactionNoun;
};

const createTransactionCountSemanticQuery = () => ({
  domain: 'transactions',
  intent: 'transactions_query',
  action: 'transfer_money',
  filters: { type: 'transfer' },
  timeRange: null,
  aggregation: 'count',
  limit: null
});

const normalizeFinalSemanticQuery = ({ userInput, finalParse }) => {
  const shouldForceCount = isTransactionCountQuestion(userInput);
  const shouldNormalizeTransactions = shouldForceCount
    || (finalParse.domain === 'transactions' && finalParse.intent === 'recent_transactions');

  if (!shouldNormalizeTransactions) {
    return finalParse.semanticQuery;
  }

  const seedSemanticQuery = shouldForceCount
    ? {
      ...createTransactionCountSemanticQuery(),
      ...(finalParse.semanticQuery || {}),
      filters: {
        type: 'transfer',
        ...(finalParse.semanticQuery?.filters || {})
      },
      aggregation: 'count',
      limit: null
    }
    : finalParse.semanticQuery;

  const normalized = normalizeTransactionSemanticQuery({
    userInput,
    currentDate: getCurrentDateForPrompt(),
    semanticQuery: seedSemanticQuery
  });

  return validateSemanticQuery(normalized) || finalParse.semanticQuery;
};

const normalizeFinalParse = ({ userInput, finalParse }) => {
  if (!isTransactionCountQuestion(userInput)) return finalParse;

  return {
    ...finalParse,
    domain: 'transactions',
    intent: 'recent_transactions',
    confidence: finalParse.confidence || 0.95,
    toolName: 'count_transfers',
    isAmbiguous: false,
    ambiguityReason: null
  };
};

export const detectIntent = async ({
  userInput,
  history = [],
  createChatCompletion,
  abortSignal
}) => {
  const llmParsed = await parseQueryWithLlm({
    userInput,
    history,
    createChatCompletion,
    abortSignal
  });
  const rawFinalParse =
    llmParsed ||
    (createChatCompletion ? LLM_PARSE_FAILED_PARSE : LLM_UNAVAILABLE_PARSE);
  const finalParse = normalizeFinalParse({ userInput, finalParse: rawFinalParse });
  const semanticQuery = normalizeFinalSemanticQuery({ userInput, finalParse });

  return {
    intent: finalParse.intent,
    confidence: finalParse.confidence,
    domain: finalParse.domain,
    semanticQuery,
    source: finalParse.source,
    workflowContinuation: Boolean(finalParse.workflowContinuation),
    correction: finalParse.correction || null,
    transferPayload: finalParse.transferPayload || null,
    toolName: finalParse.toolName || null,
    toolArgs: finalParse.toolArgs || {},
    isAmbiguous: Boolean(finalParse.isAmbiguous),
    ambiguityReason: finalParse.ambiguityReason || null
  };
};
