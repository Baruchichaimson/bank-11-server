import { validateLlmSemanticParse } from './llmSemanticParser.js';

const ASSISTANT_TIME_ZONE = 'Asia/Jerusalem';

const pad2 = (value) => String(value).padStart(2, '0');

const getCurrentCalendarDate = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ASSISTANT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(byType.year), Number(byType.month) - 1, Number(byType.day));
};

const toIsoDate = (date) => (
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
);

const addDays = (date, days) => {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
};

const buildDate = (year, month, day) => {
  const value = new Date(year, month - 1, day);
  if (
    value.getFullYear() !== year
    || value.getMonth() !== month - 1
    || value.getDate() !== day
  ) {
    return null;
  }
  return value;
};

const rangeFromDates = (from, to = from) => ({
  from: toIsoDate(from),
  to: toIsoDate(to)
});

const normalizeText = (value) => (
  String(value || '')
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[״׳"]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
);

const hasAny = (text, patterns) => patterns.some((pattern) => pattern.test(text));

const TRANSACTION_PATTERNS = [
  /העברות?/,
  /טרנזקציות?/,
  /פעולות?/,
  /\btransfers?\b/,
  /\btransactions?\b/,
  /\bactivity\b/
];

const HISTORY_PATTERNS = [
  /היסטור/,
  /הסטור/,
  /אחרונ/,
  /רשימ/,
  /תראה/,
  /הצג/,
  /תציג/,
  /תביא/,
  /שעשיתי/,
  /שביצעתי/,
  /ששלחתי/,
  /שקיבלתי/,
  /כמות/,
  /כמה/,
  /מספר/,
  /בטווח/,
  /בין\s+/,
  /מתאריך/,
  /עד\s+/,
  /החודש/,
  /חודש/,
  /השבוע/,
  /שבוע/,
  /היום/,
  /אתמול/,
  /\bhistory\b/,
  /\brecent\b/,
  /\blatest\b/,
  /\blast\b/,
  /\blist\b/,
  /\bshow\b/,
  /\bcount\b/,
  /\bhow many\b/,
  /\bbetween\b/,
  /\bthis month\b/,
  /\blast month\b/
];

const TRANSFER_EXECUTION_PATTERNS = [
  /אני רוצה לבצע העברה/,
  /לבצע העברה/,
  /לעשות העברה/,
  /להעביר כסף/,
  /תעביר/,
  /\bsend money\b/,
  /\bmake a transfer\b/,
  /\btransfer money\b/
];

const PAST_OR_FILTER_PATTERNS = [
  /היסטור/,
  /הסטור/,
  /אחרונ/,
  /שעשיתי/,
  /שביצעתי/,
  /ששלחתי/,
  /שקיבלתי/,
  /כמות/,
  /כמה/,
  /מספר/,
  /בטווח/,
  /בין\s+/,
  /מתאריך/,
  /החודש/,
  /חודש שעבר/,
  /השבוע/,
  /שבוע שעבר/,
  /היום/,
  /אתמול/,
  /\bhistory\b/,
  /\brecent\b/,
  /\blatest\b/,
  /\blast\b/,
  /\bcount\b/,
  /\bhow many\b/,
  /\bbetween\b/
];

const looksLikeTransactionHistory = (text) => {
  if (!hasAny(text, TRANSACTION_PATTERNS)) return false;
  if (!hasAny(text, HISTORY_PATTERNS)) return false;

  if (
    hasAny(text, TRANSFER_EXECUTION_PATTERNS)
    && !hasAny(text, PAST_OR_FILTER_PATTERNS)
  ) {
    return false;
  }

  return true;
};

const TYPE_RULES = [
  { type: 'withdraw', action: 'withdraw_money', patterns: [/משיכות?/, /\bwithdrawals?\b/] },
  { type: 'deposit', action: 'deposit_money', patterns: [/הפקדות?/, /\bdeposits?\b/] },
  { type: 'transfer', action: 'transfer_money', patterns: [/העברות?/, /\btransfers?\b/] }
];

const inferType = (text) => {
  const match = TYPE_RULES.find((rule) => hasAny(text, rule.patterns));
  return match ? { action: match.action, type: match.type } : { action: null, type: null };
};

const COUNT_PATTERNS = [
  /כמות\s+(?:ה)?(?:העברות|פעולות|טרנזקציות)/,
  /מספר\s+(?:ה)?(?:העברות|פעולות|טרנזקציות)/,
  /כמה\s+(?:העברות|פעולות|טרנזקציות).*(?:עשיתי|ביצעתי|שלחתי|קיבלתי|היו|יש)/,
  /(?:עשיתי|ביצעתי|שלחתי|קיבלתי).*(?:כמה\s+)?(?:העברות|פעולות|טרנזקציות)/,
  /\bhow many\b.*\b(transfers|transactions|activities)\b/,
  /\bcount\b.*\b(transfers|transactions|activities)\b/,
  /\bnumber of\b.*\b(transfers|transactions|activities)\b/
];

const isCountQuery = (text) => hasAny(text, COUNT_PATTERNS);

const NUMBER_PHRASES = [
  ['עשרים וחמש', 25],
  ['עשרים וחמישה', 25],
  ['עשרים וארבע', 24],
  ['עשרים וארבעה', 24],
  ['עשרים ושלוש', 23],
  ['עשרים ושלושה', 23],
  ['עשרים ושתיים', 22],
  ['עשרים ושניים', 22],
  ['עשרים ואחת', 21],
  ['עשרים ואחד', 21],
  ['עשרים', 20],
  ['תשע עשרה', 19],
  ['שמונה עשרה', 18],
  ['שבע עשרה', 17],
  ['שבעה עשר', 17],
  ['שש עשרה', 16],
  ['ששה עשר', 16],
  ['חמש עשרה', 15],
  ['חמישה עשר', 15],
  ['ארבע עשרה', 14],
  ['ארבעה עשר', 14],
  ['שלוש עשרה', 13],
  ['שלושה עשר', 13],
  ['שתים עשרה', 12],
  ['שנים עשר', 12],
  ['אחת עשרה', 11],
  ['אחד עשר', 11],
  ['עשר', 10],
  ['תשע', 9],
  ['תשעה', 9],
  ['שמונה', 8],
  ['שבע', 7],
  ['שבעה', 7],
  ['שש', 6],
  ['ששה', 6],
  ['חמש', 5],
  ['חמישה', 5],
  ['ארבע', 4],
  ['ארבעה', 4],
  ['שלוש', 3],
  ['שלושה', 3],
  ['שתיים', 2],
  ['שניים', 2],
  ['שתי', 2],
  ['שני', 2],
  ['אחת', 1],
  ['אחד', 1]
];

const ENGLISH_NUMBER_PHRASES = [
  ['twenty five', 25],
  ['twenty four', 24],
  ['twenty three', 23],
  ['twenty two', 22],
  ['twenty one', 21],
  ['twenty', 20],
  ['nineteen', 19],
  ['eighteen', 18],
  ['seventeen', 17],
  ['sixteen', 16],
  ['fifteen', 15],
  ['fourteen', 14],
  ['thirteen', 13],
  ['twelve', 12],
  ['eleven', 11],
  ['ten', 10],
  ['nine', 9],
  ['eight', 8],
  ['seven', 7],
  ['six', 6],
  ['five', 5],
  ['four', 4],
  ['three', 3],
  ['two', 2],
  ['one', 1]
];

const NUMBERED_TRANSACTION_PATTERN = /(?:^|[^\d./-])(\d{1,2})\s+(?:העברות|פעולות|טרנזקציות|transfers|transactions|activities)\b/;

const extractLimit = (text) => {
  const digitMatch = text.match(NUMBERED_TRANSACTION_PATTERN);
  if (digitMatch) {
    const value = Number(digitMatch[1]);
    if (Number.isInteger(value) && value > 0 && value <= 100) return value;
  }

  const allPhrases = [...NUMBER_PHRASES, ...ENGLISH_NUMBER_PHRASES];
  const phraseMatch = allPhrases.find(([phrase]) => (
    new RegExp(`(?:^|\\s)${phrase}\\s+(?:העברות|פעולות|טרנזקציות|transfers|transactions|activities)\\b`).test(text)
  ));
  if (phraseMatch) return phraseMatch[1];

  if (/העברה\s+אחרונה|\blatest transfer\b|\blast transfer\b/.test(text)) {
    return 1;
  }

  return null;
};

const parseDateToken = (token, today) => {
  const isoMatch = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return buildDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const parts = token.split(/[./]/).map((part) => Number(part));
  if (parts.length < 2 || parts.some((part) => !Number.isInteger(part))) return null;

  const year = parts[2]
    ? (parts[2] < 100 ? 2000 + parts[2] : parts[2])
    : today.getFullYear();

  return buildDate(year, parts[1], parts[0]);
};

const extractExplicitDateRange = (text, today) => {
  const tokens = [...text.matchAll(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\b/g)]
    .map((match) => parseDateToken(match[0], today))
    .filter(Boolean);

  if (tokens.length >= 2) {
    return rangeFromDates(tokens[0], tokens[1]);
  }

  if (tokens.length === 1) {
    return rangeFromDates(tokens[0]);
  }

  return null;
};

const extractRelativeDateRange = (text, today) => {
  const lastDays = text.match(/(?:ב)?(?:-|־)?(\d{1,2})\s+ימים\s+אחרונים|\blast\s+(\d{1,2})\s+days\b/);
  if (lastDays) {
    const days = Number(lastDays[1] || lastDays[2]);
    if (Number.isInteger(days) && days > 0 && days <= 90) {
      return rangeFromDates(addDays(today, -(days - 1)), today);
    }
  }

  if (/חודש\s+שעבר|החודש\s+שעבר|\blast month\b/.test(text)) {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return rangeFromDates(start, end);
  }

  if (/החודש|חודש\s+זה|\bthis month\b/.test(text)) {
    return rangeFromDates(new Date(today.getFullYear(), today.getMonth(), 1), today);
  }

  if (/שבוע\s+שעבר|השבוע\s+שעבר|\blast week\b/.test(text)) {
    const thisWeekStart = addDays(today, -today.getDay());
    const start = addDays(thisWeekStart, -7);
    const end = addDays(thisWeekStart, -1);
    return rangeFromDates(start, end);
  }

  if (/השבוע|שבוע\s+זה|\bthis week\b/.test(text)) {
    return rangeFromDates(addDays(today, -today.getDay()), today);
  }

  if (/שנה\s+שעברה|השנה\s+שעברה|\blast year\b/.test(text)) {
    const year = today.getFullYear() - 1;
    return rangeFromDates(new Date(year, 0, 1), new Date(year, 11, 31));
  }

  if (/השנה|שנה\s+זאת|\bthis year\b/.test(text)) {
    return rangeFromDates(new Date(today.getFullYear(), 0, 1), today);
  }

  if (/אתמול|\byesterday\b/.test(text)) {
    const yesterday = addDays(today, -1);
    return rangeFromDates(yesterday);
  }

  if (/היום|\btoday\b/.test(text)) {
    return rangeFromDates(today);
  }

  return null;
};

const extractDateRange = (text) => {
  const today = getCurrentCalendarDate();
  return extractExplicitDateRange(text, today) || extractRelativeDateRange(text, today);
};

const extractRecipientName = (text) => {
  const match = text.match(/(?:עם|מול)\s+([a-zא-ת][a-zא-ת'-]{1,40})/i);
  if (!match) return null;

  const value = match[1].trim();
  if (/^(העברות|פעולות|טרנזקציות|חודש|שבוע|היום|אתמול)$/.test(value)) return null;
  return value;
};

const buildPayload = ({ text }) => {
  const { action, type } = inferType(text);
  const countQuery = isCountQuery(text);
  const recipientName = extractRecipientName(text);
  const limit = countQuery ? null : extractLimit(text);
  const dateRange = extractDateRange(text);
  let aggregation = 'list';

  if (recipientName) {
    aggregation = 'counterparty';
  } else if (countQuery) {
    aggregation = 'count';
  } else if (limit || /אחרונ|\brecent\b|\blatest\b|\blast\b/.test(text)) {
    aggregation = 'first_n';
  }

  const semanticQuery = {
    domain: 'transactions',
    intent: 'transactions_query',
    action,
    filters: { type },
    timeRange: null,
    dateRange: dateRange || { from: null, to: null },
    aggregation,
    limit: aggregation === 'count' ? null : limit,
    recipientName
  };

  return {
    domain: 'transactions',
    intent: 'recent_transactions',
    confidence: 0.95,
    isAmbiguous: false,
    ambiguityReason: null,
    toolName: null,
    toolArgs: {},
    workflowContinuation: false,
    correction: null,
    transferPayload: null,
    semanticQuery
  };
};

export const parseQueryLocally = ({ userInput } = {}) => {
  const text = normalizeText(userInput);
  if (!text || !looksLikeTransactionHistory(text)) return null;

  const validated = validateLlmSemanticParse(buildPayload({ text }));
  if (!validated) return null;

  return {
    ...validated,
    source: 'local_semantic_parser'
  };
};
