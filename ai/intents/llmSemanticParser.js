import {
  TOOL_CATALOG,
  ALLOWED_DOMAINS as ALLOWED_DOMAIN_VALUES,
  ALLOWED_INTENTS as ALLOWED_INTENT_VALUES,
  ALLOWED_TOOL_NAMES as ALLOWED_TOOL_NAME_VALUES,
  formatResponseContractForPrompt,
  formatSemanticCatalogForPrompt
} from './before-llm/semanticCatalog.js';
import { buildUserPromptPayload } from './before-llm/llmPromptPayloadBuilder.js';
import { logSemanticParserFailure } from './after-llm/llmParserLogger.js';
import {
  normalizeConfidenceField,
  normalizeEnumString,
  normalizeStringField
} from './after-llm/llmValueNormalizers.js';
import { validateSemanticQuery } from './after-llm/semanticQueryValidator.js';
import {
  validateCorrection,
  validateToolArgs,
  validateTransferPayload
} from './after-llm/transferPayloadValidator.js';
import {
  createAmbiguousIntent,
  createIntentResult
} from '../contracts/intentResultContract.js';

export { validateSemanticQuery } from './after-llm/semanticQueryValidator.js';

export const buildSemanticParserPrompt = () => {
  return `
You are a conversation-aware semantic banking intent classifier.

Your job is not to answer the user.
Your job is to convert the current user message into one strict JSON routing object.
Use recent conversation context only to resolve short follow-up messages.

Return ONLY valid JSON. No markdown. No explanations. No comments.

Response contract:
${formatResponseContractForPrompt()}

Semantic intent contract:
${formatSemanticCatalogForPrompt()}

Core routing:
- classify by the meaning of the requested action, not by keyword overlap.
- Prefer semantic intent/query fields over toolName.
- balance/current money => domain account, intent check_balance, semanticQuery null, toolName null.
- past activity/history/list/count/filter existing transactions => domain transactions, intent recent_transactions.
- starting/confirming/correcting/canceling a new transfer => domain transactions, intent transfer_money.
- stored user identity/profile details => domain profile, intent show_personal_details.
- representative/support/video call => domain support, intent contact_support.
- Hebrew requests like "תתקשר לנציג", "אני רוצה לדבר עם נציג", "תחבר אותי לנציג", or "שיחת וידאו עם נציג" => domain support, intent contact_support.
- unsupported, casual, or ambiguous input => domain unknown, intent unknown, toolName null.
- toolName is legacy compatibility. Use it only for UI actions or legacy payloads; do not use toolName as the primary way to request banking data.

Transaction history parameter extraction:
- Always return semanticQuery for recent_transactions.
- Use semanticQuery.domain="transactions" and semanticQuery.intent="transactions_query".
- Transfer history means action="transfer_money" and filters.type="transfer".
- For transfers the user sent/performed ("שביצעתי", "ששלחתי", "שלחתי"), set filters.direction="outgoing".
- For transfers the user received ("שקיבלתי", "קיבלתי", "נכנסות"), set filters.direction="incoming".
- For all transfers ("כל ההעברות"), omit filters.direction or set filters.direction="all".
- Generic activity/transactions without a specific type means action=null and filters.type=null.
- Questions asking how many/count => aggregation="count", limit=null.
- Questions asking for a specific number of rows => aggregation="first_n", limit=<number>.
- Questions asking to show/list without a specific number => aggregation="list".
- Singular latest/earliest requests like "מה ההעברה האחרונה שביצעתי?" or "latest transfer" => aggregation="first_n", limit=1.
- Preserve explicit numeric limits. Convert Hebrew and English number words: שני/שתי/שתיים=2, שלוש/שלושה=3, ארבע/ארבעה=4, חמש/חמישה=5, עשר=10, עשרים=20, עשרים וחמש=25.
- אחרונות/האחרונות/אחרונים/latest/newest/most recent => sortDirection="desc".
- ראשונות/הראשונות/ראשונים/first/earliest/oldest => sortDirection="asc".
- If the user asks for N latest/earliest rows, use aggregation="first_n", limit=N, and the matching sortDirection.

Date extraction:
- Return semanticQuery.dateRange as {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"} when the user specifies a date or relative period.
- Use the currentDate field from the user payload for all relative dates.
- חודש שעבר / חודש קודם / החודש שעבר / החודש הקודם / last month / previous month => full previous calendar month.
- If currentDate is 2026-06-04, previous month is {"from":"2026-05-01","to":"2026-05-31"}.
- החודש / חודש נוכחי / this month => from the first day of the current month through currentDate.
- השבוע / this week => current calendar week through currentDate.
- השבוע האחרון / מהשבוע האחרון / past week => the last 7 days through currentDate.
- השנה / this year => from January 1 through currentDate.
- Keep semanticQuery.timeRange=null. Never return database filters, createdAt, or Date objects.

Examples:
- User: "תתקשר לנציג"
  JSON: {"domain":"support","intent":"contact_support","confidence":0.95,"semanticQuery":null,"toolName":null}
- User: "אני רוצה לדבר עם נציג"
  JSON: {"domain":"support","intent":"contact_support","confidence":0.95,"semanticQuery":null,"toolName":null}
- User: "מה הם 2 העברות האחרונות שביצעתי?"
  JSON: {"domain":"transactions","intent":"recent_transactions","confidence":0.95,"semanticQuery":{"domain":"transactions","intent":"transactions_query","action":"transfer_money","filters":{"type":"transfer","direction":"outgoing"},"timeRange":null,"aggregation":"first_n","limit":2,"sortDirection":"desc"}}
- User: "תראה לי את ההעברות שקיבלתי החודש"
  JSON: {"domain":"transactions","intent":"recent_transactions","confidence":0.95,"semanticQuery":{"domain":"transactions","intent":"transactions_query","action":"transfer_money","filters":{"type":"transfer","direction":"incoming"},"timeRange":null,"dateRange":{"from":"YYYY-MM-01","to":"currentDate"},"aggregation":"list","limit":null,"sortDirection":"desc"}}
- User: "תראה לי 3 העברות מהשבוע האחרון"
  JSON: {"domain":"transactions","intent":"recent_transactions","confidence":0.95,"semanticQuery":{"domain":"transactions","intent":"transactions_query","action":"transfer_money","filters":{"type":"transfer"},"timeRange":null,"dateRange":{"from":"currentDate minus 6 days","to":"currentDate"},"aggregation":"first_n","limit":3,"sortDirection":"desc"}}

Safety and confidence:
- Extract only values explicitly present or clearly implied by the current message/context.
- Never invent transfer recipient, amount, description, dates, or confirmation.
- If confidence is below 0.65, return unknown.
- If ambiguous between workflows, set isAmbiguous=true, give a short ambiguityReason, and return unknown/unknown.
`.trim();
};

const ALLOWED_DOMAINS = new Set(ALLOWED_DOMAIN_VALUES);
const ALLOWED_INTENTS = new Set(ALLOWED_INTENT_VALUES);
const ALLOWED_TOOL_NAMES = new Set(ALLOWED_TOOL_NAME_VALUES);
const TOOL_BY_NAME = Object.fromEntries(TOOL_CATALOG.map((tool) => [tool.toolName, tool]));
const UI_ACTION_TOOL_NAMES = new Set(['open_money_transfer_inline', 'open_video_call_window']);

const DOMAIN_ALIASES = {
  balance: 'account',
  account_balance: 'account',
  identity: 'profile',
  user: 'profile',
  personal: 'profile',
  transfer: 'transactions',
  transfers: 'transactions',
  transaction: 'transactions',
  representative: 'support',
  agent: 'support',
  help: 'support'
};

const INTENT_ALIASES = {
  get_user_identity: 'show_personal_details',
  get_user_name: 'show_personal_details',
  get_user_details: 'show_personal_details',
  personal_details: 'show_personal_details',
  get_balance: 'check_balance',
  account_summary: 'check_balance',
  balance: 'check_balance',
  get_recent_transfers: 'recent_transactions',
  count_transfers: 'recent_transactions',
  get_last_sent_transfer_to_recipient: 'recent_transactions',
  transactions_query: 'recent_transactions',
  open_money_transfer_inline: 'transfer_money',
  send_money: 'transfer_money',
  make_transfer: 'transfer_money',
  open_video_call_window: 'contact_support',
  talk_to_agent: 'contact_support',
  talk_to_representative: 'contact_support',
  contact_agent: 'contact_support',
  contact_representative: 'contact_support',
  connect_representative: 'contact_support',
  start_video_call: 'contact_support',
  video_call: 'contact_support',
  support: 'contact_support',
  representative: 'contact_support'
};

const normalizeDomain = (value, toolName = null) => {
  const normalized = normalizeEnumString(value);
  const fromTool = toolName ? TOOL_BY_NAME[toolName]?.domain : null;
  const aliased = DOMAIN_ALIASES[normalized] || normalized;
  if ((!aliased || aliased === 'unknown') && fromTool) return fromTool;
  return ALLOWED_DOMAINS.has(aliased) ? aliased : fromTool || 'unknown';
};

const normalizeIntent = (value, toolName = null) => {
  const normalized = normalizeEnumString(value);
  const fromTool = toolName ? TOOL_BY_NAME[toolName]?.intent : null;
  const aliased = INTENT_ALIASES[normalized] || normalized;
  if ((!aliased || aliased === 'unknown') && fromTool) return fromTool;
  return ALLOWED_INTENTS.has(aliased) ? aliased : fromTool || 'unknown';
};

const normalizeToolName = (value) => {
  const normalized = normalizeEnumString(value);
  return ALLOWED_TOOL_NAMES.has(normalized) ? normalized : null;
};

const buildLegacySemanticQueryFromTool = ({ toolName, toolArgs = {} }) => {
  if (!toolName) return null;

  if (toolName === 'count_transfers') {
    return {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      timeRange: null,
      aggregation: 'count',
      limit: null,
      recipientName: null
    };
  }

  if (toolName === 'get_recent_transfers') {
    return {
      domain: 'transactions',
      intent: 'transactions_query',
      action: null,
      filters: { type: null },
      timeRange: null,
      aggregation: 'list',
      limit: null,
      recipientName: null
    };
  }

  if (toolName === 'get_last_sent_transfer_to_recipient') {
    const recipientName = normalizeStringField(toolArgs.recipientName);
    if (!recipientName) return null;
    return {
      domain: 'transactions',
      intent: 'transactions_query',
      action: 'transfer_money',
      filters: { type: 'transfer' },
      timeRange: null,
      aggregation: 'counterparty',
      limit: 10,
      recipientName
    };
  }

  return null;
};

export const validateLlmSemanticParse = (payload) => {
  if (!payload || typeof payload !== 'object') return null;

  const rawTool = payload.tool && typeof payload.tool === 'object' ? payload.tool : null;
  const toolName = normalizeToolName(payload.toolName || rawTool?.name || payload.tool || payload.name);
  const toolArgs = validateToolArgs(payload.toolArgs || rawTool?.args || payload.args);
  const domain = normalizeDomain(payload.domain, toolName);
  const intent = normalizeIntent(payload.intent, toolName);
  const workflowContinuation = payload.workflowContinuation;
  const correction = validateCorrection(payload.correction);
  const transferPayload = validateTransferPayload(payload.transferPayload);
  const modelConfidence = normalizeConfidenceField(payload.confidence);
  const isAmbiguous = payload.isAmbiguous === true;
  const ambiguityReason = normalizeStringField(payload.ambiguityReason);
  const hasSemanticQueryInput = payload.semanticQuery && typeof payload.semanticQuery === 'object';
  const shouldKeepTool = Boolean(toolName && (UI_ACTION_TOOL_NAMES.has(toolName) || !hasSemanticQueryInput));
  const outputTool = shouldKeepTool ? { name: toolName, args: toolArgs } : null;

  const buildResult = ({ resultDomain, resultIntent, defaultConfidence, semanticQuery = null }) => createIntentResult({
    source: 'llm_semantic_parser',
    domain: resultDomain,
    intent: resultIntent,
    confidence: resultIntent === 'unknown' ? 0 : modelConfidence ?? defaultConfidence,
    semanticQuery,
    workflowContinuation,
    correction,
    transferPayload,
    tool: outputTool,
    ambiguity: isAmbiguous
      ? { isAmbiguous: true, reason: ambiguityReason }
      : null
  });

  if (isAmbiguous) {
    return createAmbiguousIntent({
      source: 'llm_semantic_parser',
      reason: ambiguityReason,
      workflowContinuation,
      correction,
      transferPayload,
      tool: outputTool
    });
  }

  if (modelConfidence !== null && modelConfidence < 0.65) {
    return buildResult({ resultDomain: 'unknown', resultIntent: 'unknown', defaultConfidence: 0 });
  }

  if (domain === 'unknown' || intent === 'unknown') {
    return buildResult({
      resultDomain: 'unknown',
      resultIntent: 'unknown',
      defaultConfidence: 0
    });
  }

  if (domain === 'transactions' && intent === 'recent_transactions') {
    const rawSemanticQuery = hasSemanticQueryInput
      ? payload.semanticQuery
      : buildLegacySemanticQueryFromTool({ toolName, toolArgs });
    const semanticQuery = validateSemanticQuery(rawSemanticQuery);
    if (!semanticQuery) return null;
    return buildResult({
      resultDomain: domain,
      resultIntent: intent,
      defaultConfidence: 0.9,
      semanticQuery
    });
  }

  const expectedIntentByDomain = {
    profile: 'show_personal_details',
    account: 'check_balance',
    support: 'contact_support',
    unknown: 'unknown'
  };
  if (expectedIntentByDomain[domain] === intent) {
    return buildResult({
      resultDomain: domain,
      resultIntent: intent,
      defaultConfidence: domain === 'unknown' ? 0 : 0.85
    });
  }

  if (domain === 'transactions' && intent === 'transfer_money') {
    return buildResult({
      resultDomain: domain,
      resultIntent: intent,
      defaultConfidence: 0.85
    });
  }

  return null;
};

const parseJsonContent = (content) => {
  const text = String(content || '').trim();
  if (!text) {
    throw new Error('LLM semantic parser did not return a JSON object');
  }
  return JSON.parse(text);
};

export const parseQueryWithLlm = async ({
  userInput,
  history = [],
  createChatCompletion,
  abortSignal
}) => {
  if (!createChatCompletion) return null;

  let rawContent = '';
  try {
    const systemPrompt = buildSemanticParserPrompt();
    const response = await createChatCompletion({
      temperature: 0,
      top_p: 1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(buildUserPromptPayload({ userInput, history })) }
      ],
      abortSignal
    });

    rawContent = response?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonContent(rawContent);
    const validated = validateLlmSemanticParse(parsed);
    if (!validated) {
      logSemanticParserFailure({ reason: 'validation_failed', rawContent, parsed });
      return null;
    }
    return validated;
  } catch (err) {
    logSemanticParserFailure({ reason: 'parse_error', error: err, rawContent });
    return null;
  }
};
