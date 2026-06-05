import { parseQueryWithLlm, validateSemanticQuery } from '../llmSemanticParser.js';
import { normalizeTransactionSemanticQuery } from '../after-llm/transactionQueryNormalizer.js';
import { getCurrentDateForPrompt } from './llmPromptPayloadBuilder.js';
import {
  createIntentResult,
  createUnknownIntent,
  normalizeIntentResult
} from '../../contracts/intentResultContract.js';

const LLM_UNAVAILABLE_PARSE = createUnknownIntent({ source: 'llm_unavailable' });
const LLM_PARSE_FAILED_PARSE = createUnknownIntent({ source: 'llm_parse_failed' });

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

const TRANSACTION_LIST_NOUN_PATTERN = '(?:ה?העברות?|ה?העברה|ה?פעולות?|ה?פעולה|ה?טרנזקציות?|ה?טרנזקציה|transfers?|transactions?|activities|activity)';
const SINGULAR_TRANSACTION_NOUN_PATTERN = '(?:ה?העברה|ה?פעולה|ה?טרנזקציה|transfer|transaction|activity)';
const SINGLE_VALUE_PATTERN = '(?:1|אחד|אחת|one|single)';
const ORDER_WORD_PATTERN = '(?:אחרונה|אחרון|ראשונה|ראשון|latest|newest|first|earliest|oldest|most\\s+recent)';

const isTransactionCountQuestion = (userInput) => {
  const text = normalizeUserText(userInput);
  const asksCount = /(?:^|\s)כמה(?:\s|$)/.test(text)
    || /מה\s+(?:מספר|כמות)\s+ה/.test(text)
    || /how\s+many/i.test(text)
    || /\bcount\b/i.test(text)
    || /\bnumber\s+of\b/i.test(text);
  return asksCount && textHasTransactionNoun(text);
};

const hasExplicitSingleRowRequest = (text) => (
  new RegExp(`(?:^|\\s)${SINGLE_VALUE_PATTERN}\\s+${TRANSACTION_LIST_NOUN_PATTERN}(?:\\s|$)`, 'i').test(text)
  || new RegExp(`${TRANSACTION_LIST_NOUN_PATTERN}\\s+${SINGLE_VALUE_PATTERN}(?:\\s|$)`, 'i').test(text)
  || new RegExp(`${SINGULAR_TRANSACTION_NOUN_PATTERN}\\s+(?:ה)?${ORDER_WORD_PATTERN}(?:\\s|$)`, 'i').test(text)
  || new RegExp(`(?:^|\\s)${ORDER_WORD_PATTERN}\\s+${SINGULAR_TRANSACTION_NOUN_PATTERN}(?:\\s|$)`, 'i').test(text)
);

const fixListQuestionLimitOne = ({ userInput, semanticQuery }) => {
  const text = normalizeUserText(userInput);
  const shouldFixAccidentalSingleRow =
    semanticQuery?.aggregation === 'first_n'
    && semanticQuery.limit === 1
    && textHasTransactionNoun(text)
    && !isTransactionCountQuestion(userInput)
    && !hasExplicitSingleRowRequest(text);

  if (!shouldFixAccidentalSingleRow) return semanticQuery;

  return {
    ...semanticQuery,
    aggregation: 'list',
    limit: null
  };
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

const HEBREW_TRANSFER_START_PATTERNS = [
  /(?:^|\s)(?:תבצע|בצע|לבצע|תעשה|לעשות)\s+(?:לי\s+)?העברה(?:\s|$)/,
  /(?:^|\s)(?:אני\s+)?(?:רוצה|צריך|צריכה|מעוניין|מעוניינת)\s+(?:לבצע|לעשות)\s+(?:לי\s+)?העברה(?:\s|$)/,
  /(?:^|\s)(?:תפתח|פתח|לפתוח)\s+(?:לי\s+)?העברה(?:\s|$)/,
  /(?:^|\s)(?:אני\s+)?(?:רוצה|צריך|צריכה|מעוניין|מעוניינת)\s+להעביר\s+כסף(?:\s|$)/,
  /(?:^|\s)(?:תעביר|העבר)\s+(?:לי\s+)?כסף(?:\s|$)/
];

const HEBREW_BALANCE_PATTERNS = [
  /(?:^|\s)מה\s+ה?יי?תרה(?:\s+שלי)?(?:\s+בחשבון(?:\s+שלי)?)?(?:\s|$)/,
  /(?:^|\s)כמה\s+כסף\s+יש\s+לי(?:\s+בחשבון(?:\s+שלי)?)?(?:\s|$)/,
  /(?:^|\s)(?:תראה|הראה|הצג|תציג)\s+(?:לי\s+)?ה?יי?תרה(?:\s|$)/
];

const HEBREW_PROFILE_PATTERNS = [
  /(?:^|\s)מה\s+ה?שם\s+שלי(?:\s|$)/,
  /(?:^|\s)מה\s+ה?(?:מייל|אימייל)\s+שלי(?:\s|$)/,
  /(?:^|\s)איזה\s+(?:מייל|אימייל)\s+יש\s+לי\s+במערכת(?:\s|$)/,
  /(?:^|\s)מה\s+ה?פרטים(?:\s+האישיים)?\s+שלי(?:\s|$)/
];

const HEBREW_SUPPORT_PATTERNS = [
  /(?:^|\s)(?:תתקשר|התקשר|תתקשרו|תתקשרי)\s+(?:לי\s+)?(?:אל\s+)?ל?נציג(?:\s|$)/,
  /(?:^|\s)(?:אני\s+)?(?:רוצה|צריך|צריכה|מעוניין|מעוניינת)\s+לדבר\s+עם\s+נציג(?:\s|$)/,
  /(?:^|\s)אפשר\s+(?:לדבר\s+עם\s+)?נציג(?:\s|$)/,
  /(?:^|\s)(?:תחבר|חבר|חברי|חברו)\s+(?:אותי|לי)\s+(?:אל\s+|עם\s+|ל)?נציג(?:\s|$)/,
  /(?:^|\s)(?:תפתח|פתח|פתחי|פתחו)\s+(?:לי\s+)?שיחה\s+עם\s+נציג(?:\s|$)/,
  /(?:^|\s)(?:אני\s+)?(?:צריך|צריכה|רוצה)\s+עזרה\s+(?:מנציג|עם\s+נציג)(?:\s|$)/,
  /(?:^|\s)שיחת\s+וידאו\s+עם\s+נציג(?:\s|$)/,
  /(?:^|\s)(?:תעשה|עשה|עשי|עשו)\s+(?:לי\s+)?שיחה\s+עם\s+נציג(?:\s|$)/,
  /(?:^|\s)צור\s+קשר\s+עם\s+נציג(?:\s|$)/
];

const isObviousHebrewTransferStart = (userInput) => {
  const text = normalizeUserText(userInput);
  if (!/[\u0590-\u05FF]/.test(text)) return false;
  if (isTransactionCountQuestion(userInput)) return false;
  return HEBREW_TRANSFER_START_PATTERNS.some((pattern) => pattern.test(text));
};

const isObviousHebrewBalanceRequest = (userInput) => {
  const text = normalizeUserText(userInput);
  if (!/[\u0590-\u05FF]/.test(text)) return false;
  return HEBREW_BALANCE_PATTERNS.some((pattern) => pattern.test(text));
};

const isObviousHebrewProfileRequest = (userInput) => {
  const text = normalizeUserText(userInput);
  if (!/[\u0590-\u05FF]/.test(text)) return false;
  return HEBREW_PROFILE_PATTERNS.some((pattern) => pattern.test(text));
};

const isObviousHebrewSupportRequest = (userInput) => {
  const text = normalizeUserText(userInput);
  if (!/[\u0590-\u05FF]/.test(text)) return false;
  return HEBREW_SUPPORT_PATTERNS.some((pattern) => pattern.test(text));
};

const createHebrewTransferStartFallback = () => createIntentResult({
  domain: 'transactions',
  intent: 'transfer_money',
  confidence: 0.9,
  source: 'deterministic_hebrew_transfer_start'
});

const createHebrewBalanceFallback = () => createIntentResult({
  domain: 'account',
  intent: 'check_balance',
  confidence: 0.9,
  source: 'deterministic_hebrew_balance'
});

const createHebrewProfileFallback = () => createIntentResult({
  domain: 'profile',
  intent: 'show_personal_details',
  confidence: 0.9,
  source: 'deterministic_hebrew_profile'
});

const createHebrewSupportFallback = () => createIntentResult({
  domain: 'support',
  intent: 'contact_support',
  confidence: 0.9,
  source: 'deterministic_hebrew_support'
});

const applyDeterministicFallback = ({ userInput, finalParse }) => {
  if (finalParse.intent !== 'unknown') return finalParse;
  if (finalParse.ambiguity?.isAmbiguous) return finalParse;
  if (isObviousHebrewTransferStart(userInput)) return createHebrewTransferStartFallback();
  if (isObviousHebrewBalanceRequest(userInput)) return createHebrewBalanceFallback();
  if (isObviousHebrewProfileRequest(userInput)) return createHebrewProfileFallback();
  if (isObviousHebrewSupportRequest(userInput)) return createHebrewSupportFallback();
  return finalParse;
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

  return createIntentResult({
    ...finalParse,
    domain: 'transactions',
    intent: 'recent_transactions',
    confidence: finalParse.confidence || 0.95,
    tool: null,
    ambiguity: null
  });
};

export const detectIntent = async ({
  userInput,
  history = [],
  createChatCompletion,
  abortSignal
}) => {
  const parsed = await parseQueryWithLlm({
    userInput,
    history,
    createChatCompletion,
    abortSignal
  });
  const llmParsed = parsed ? normalizeIntentResult(parsed) : null;
  const rawFinalParse =
    llmParsed ||
    (createChatCompletion ? LLM_PARSE_FAILED_PARSE : LLM_UNAVAILABLE_PARSE);
  const fallbackAwareParse = applyDeterministicFallback({
    userInput,
    finalParse: normalizeIntentResult(rawFinalParse)
  });
  const finalParse = normalizeFinalParse({ userInput, finalParse: fallbackAwareParse });
  const semanticQuery = normalizeFinalSemanticQuery({ userInput, finalParse });

  return createIntentResult({
    ...finalParse,
    semanticQuery,
    tool: finalParse.tool,
    ambiguity: finalParse.ambiguity
  });
};
