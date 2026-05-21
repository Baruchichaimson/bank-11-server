import { sanitizeAssistantText } from '../shared/shared.js';

const SYSTEM_PROMPT = `
You are a stateless banking query parser.
Use ONLY the current user message. Ignore conversation history because none is provided.
Return ONLY strict JSON with this shape:
{
  "domain": "profile|account|transactions|support|unknown",
  "intent": "show_personal_details|check_balance|recent_transactions|transfer_money|contact_support|unknown",
  "semanticQuery": null | {
    "domain": "transactions",
    "intent": "transactions_query",
    "action": "transfer_money|withdraw_money|deposit_money",
    "filters": { "type": "transfer|withdraw|deposit|null" },
    "timeRange": "today|this_month|last_month|last_week|null",
    "aggregation": "count|list|first_n",
    "limit": number|null
  }
}

Rules:
- Past/history/count/list questions about transfers are recent_transactions.
- Requests to start, perform, or learn how to make a transfer are transfer_money, not recent_transactions.
- Extract written Hebrew numbers exactly when possible. Clamp impossible or unsafe limits to null.
- If uncertain, use unknown.
`.trim();

const ALLOWED_DOMAINS = new Set(['profile', 'account', 'transactions', 'support', 'unknown']);
const ALLOWED_INTENTS = new Set([
  'show_personal_details',
  'check_balance',
  'recent_transactions',
  'transfer_money',
  'contact_support',
  'unknown'
]);
const ALLOWED_ACTIONS = new Set(['transfer_money', 'withdraw_money', 'deposit_money']);
const ALLOWED_TYPES = new Set(['transfer', 'withdraw', 'deposit', null]);
const ALLOWED_TIME_RANGES = new Set(['today', 'this_month', 'last_month', 'last_week', null]);
const ALLOWED_AGGREGATIONS = new Set(['count', 'list', 'first_n']);

const clampLimit = (value) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 100) return null;
  return numeric;
};

const validateSemanticQuery = (semanticQuery) => {
  if (!semanticQuery || typeof semanticQuery !== 'object') return null;
  if (semanticQuery.domain !== 'transactions') return null;
  if (semanticQuery.intent !== 'transactions_query') return null;

  const action = ALLOWED_ACTIONS.has(semanticQuery.action) ? semanticQuery.action : 'transfer_money';
  const type = ALLOWED_TYPES.has(semanticQuery.filters?.type) ? semanticQuery.filters.type : 'transfer';
  const timeRange = ALLOWED_TIME_RANGES.has(semanticQuery.timeRange) ? semanticQuery.timeRange : null;
  const aggregation = ALLOWED_AGGREGATIONS.has(semanticQuery.aggregation) ? semanticQuery.aggregation : 'list';

  return {
    domain: 'transactions',
    intent: 'transactions_query',
    action,
    filters: { type },
    timeRange,
    aggregation,
    limit: aggregation === 'count' ? null : clampLimit(semanticQuery.limit)
  };
};

export const validateLlmSemanticParse = (payload) => {
  if (!payload || typeof payload !== 'object') return null;

  const domain = ALLOWED_DOMAINS.has(payload.domain) ? payload.domain : 'unknown';
  const intent = ALLOWED_INTENTS.has(payload.intent) ? payload.intent : 'unknown';

  if (domain === 'transactions' && intent === 'recent_transactions') {
    const semanticQuery = validateSemanticQuery(payload.semanticQuery);
    if (!semanticQuery) return null;
    return {
      source: 'current_message_llm_fallback',
      domain,
      intent,
      confidence: 0.9,
      semanticQuery
    };
  }

  const expectedIntentByDomain = {
    profile: 'show_personal_details',
    account: 'check_balance',
    support: 'contact_support',
    unknown: 'unknown'
  };
  if (expectedIntentByDomain[domain] === intent) {
    return {
      source: 'current_message_llm_fallback',
      domain,
      intent,
      confidence: domain === 'unknown' ? 0 : 0.85,
      semanticQuery: null
    };
  }

  if (domain === 'transactions' && intent === 'transfer_money') {
    return {
      source: 'current_message_llm_fallback',
      domain,
      intent,
      confidence: 0.85,
      semanticQuery: null
    };
  }

  return null;
};

export const parseQueryWithLlm = async ({ userInput, createChatCompletion, abortSignal }) => {
  if (!createChatCompletion) return null;

  try {
    const response = await createChatCompletion({
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: String(userInput || '').trim() }
      ],
      abortSignal
    });

    const content = sanitizeAssistantText(response?.choices?.[0]?.message?.content);
    const parsed = JSON.parse(content);
    return validateLlmSemanticParse(parsed);
  } catch {
    return null;
  }
};
