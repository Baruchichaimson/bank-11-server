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

const textHasTransactionNoun = (text) => (
  text.includes('העברה')
  || text.includes('העברות')
  || text.includes('פעולה')
  || text.includes('פעולות')
  || text.includes('טרנזקציה')
  || text.includes('טרנזקציות')
  || text.includes('transfer')
  || text.includes('transfers')
  || text.includes('transaction')
  || text.includes('transactions')
  || text.includes('activity')
  || text.includes('activities')
);

const isTransactionCountQuestion = (userInput) => {
  const text = normalizeUserText(userInput);
  const asksCount = /(?:^|\s)כמה(?:\s|$)/.test(text)
    || /מה\s+(?:מספר|כמות)\s+ה/.test(text)
    || /how\s+many/i.test(text)
    || /\bcount\b/i.test(text)
    || /\bnumber\s+of\b/i.test(text);
  return asksCount && textHasTransactionNoun(text);
};

const isTransactionListQuestion = (userInput) => {
  const text = normalizeUserText(userInput);
  const asksList = text.includes('מה הם')
    || text.includes('מה הן')
    || text.includes('תראה')
    || text.includes('הראה')
    || text.includes('הצג')
    || text.includes('פירוט')
    || text.includes('תן לי')
    || text.includes('show')
    || text.includes('list')
    || text.includes('display');
  return asksList && textHasTransactionNoun(text);
};

const isSingleLatestTransferQuestion = (userInput) => {
  const text = normalizeUserText(userInput);
  return text.includes('העברה אחרונה')
    || text.includes('העברה האחרונה')
    || text.includes('last transfer')
    || text.includes('latest transfer')
    || text.includes('newest transfer');
};

const extractRequestedTransactionLimit = (userInput) => {
  const text = normalizeUserText(userInput);
  if (!textHasTransactionNoun(text)) return null;

  const tokens = text.split(' ');
  for (const token of tokens) {
    const value = Number(token);
    if (Number.isInteger(value) && value > 0 && value <= 100) return value;
  }

  return null;
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

const fixListQuestionLimitOne = ({ userInput, semanticQuery }) => {
  if (!semanticQuery || typeof semanticQuery !== 'object') return semanticQuery;
  if (!isTransactionListQuestion(userInput)) return semanticQuery;
  if (isSingleLatestTransferQuestion(userInput)) return semanticQuery;
  if (semanticQuery.aggregation !== 'first_n' || semanticQuery.limit !== 1) return semanticQuery;

  const requestedLimit = extractRequestedTransactionLimit(userInput);
  if (requestedLimit) {
    return {
      ...semanticQuery,
      aggregation: 'first_n',
      limit: requestedLimit,
      sortDirection: semanticQuery.sortDirection || 'desc'
    };
  }

  const { sortDirection, ...withoutSortDirection } = semanticQuery;
  return {
    ...withoutSortDirection,
    aggregation: 'list',
    limit: null
  };
};

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

  const guarded = fixListQuestionLimitOne({ userInput, semanticQuery: normalized });
  return validateSemanticQuery(guarded) || finalParse.semanticQuery;
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
