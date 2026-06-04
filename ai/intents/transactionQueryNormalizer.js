const HEBREW_NUMBER_WORDS = new Map([
  ['אחד', 1],
  ['אחת', 1],
  ['שני', 2],
  ['שתי', 2],
  ['שתיים', 2],
  ['שניים', 2],
  ['שלוש', 3],
  ['שלושה', 3],
  ['ארבע', 4],
  ['ארבעה', 4],
  ['חמש', 5],
  ['חמישה', 5],
  ['שש', 6],
  ['שישה', 6],
  ['ששת', 6],
  ['שבע', 7],
  ['שבעה', 7],
  ['שבעת', 7],
  ['שמונה', 8],
  ['שמונת', 8],
  ['תשע', 9],
  ['תשעה', 9],
  ['תשעת', 9],
  ['עשר', 10],
  ['עשרה', 10],
  ['עשרת', 10],
  ['אחד עשר', 11],
  ['אחת עשרה', 11],
  ['שנים עשר', 12],
  ['שתים עשרה', 12],
  ['שלושה עשר', 13],
  ['שלוש עשרה', 13],
  ['ארבעה עשר', 14],
  ['ארבע עשרה', 14],
  ['חמישה עשר', 15],
  ['חמש עשרה', 15],
  ['שישה עשר', 16],
  ['שש עשרה', 16],
  ['שבעה עשר', 17],
  ['שבע עשרה', 17],
  ['שמונה עשר', 18],
  ['שמונה עשרה', 18],
  ['תשעה עשר', 19],
  ['תשע עשרה', 19],
  ['עשרים', 20],
  ['עשרים ואחד', 21],
  ['עשרים ואחת', 21],
  ['עשרים ושניים', 22],
  ['עשרים ושתיים', 22],
  ['עשרים ושלוש', 23],
  ['עשרים ושלושה', 23],
  ['עשרים וארבע', 24],
  ['עשרים וארבעה', 24],
  ['עשרים וחמש', 25],
  ['עשרים וחמישה', 25]
]);

const MAX_LIMIT = 100;
const TRANSACTION_NOUN_PATTERN = '(?:ה?העברות?|ה?העברה|ה?פעולות?|ה?פעולה|ה?טרנזקציות?|ה?טרנזקציה|transfers?|transactions?|activities|activity)';
const ORDER_WORD_PATTERN = '(?:אחרונות|אחרונים|אחרונה|אחרון|ראשונות|ראשונים|ראשונה|ראשון|latest|newest|first|earliest|oldest|most\\s+recent)';

const pad2 = (value) => String(value).padStart(2, '0');

const parseIsoDateParts = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
};

const formatDateParts = ({ year, month, day }) => `${year}-${pad2(month)}-${pad2(day)}`;

const daysInMonth = ({ year, month }) => new Date(year, month, 0).getDate();

const addMonths = ({ year, month, day = 1 }, offset) => {
  const date = new Date(year, month - 1 + offset, day);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  };
};

const calendarMonthRange = ({ year, month }) => ({
  from: formatDateParts({ year, month, day: 1 }),
  to: formatDateParts({ year, month, day: daysInMonth({ year, month }) })
});

const currentMonthRange = (currentDate) => ({
  from: formatDateParts({ year: currentDate.year, month: currentDate.month, day: 1 }),
  to: formatDateParts(currentDate)
});

const normalizeText = (value) => String(value || '')
  .trim()
  .replace(/[־–—]/g, '-')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const clampLimit = (value) => {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_LIMIT) return null;
  return value;
};

const includesAny = (text, patterns) => patterns.some((pattern) => pattern.test(text));

const isCountQuestion = (text) => includesAny(text, [
  /(?:^|\s)כמה(?:\s|$)/,
  /מה\s+(?:מספר|כמות)\s+ה/,
  /how\s+many/i,
  /\bcount\b/i,
  /\bnumber\s+of\b/i
]);

const hasTransactionListNoun = (text) => includesAny(text, [
  new RegExp(TRANSACTION_NOUN_PATTERN, 'i')
]);

const extractDigitLimit = (text) => {
  const beforeNoun = new RegExp(`(?:^|\\D)(\\d{1,3})\\s+${TRANSACTION_NOUN_PATTERN}`, 'i').exec(text);
  if (beforeNoun) return clampLimit(Number(beforeNoun[1]));

  const afterNoun = new RegExp(`${TRANSACTION_NOUN_PATTERN}\\s+(?:ה)?${ORDER_WORD_PATTERN}?\\s*(\\d{1,3})`, 'i').exec(text);
  if (afterNoun) return clampLimit(Number(afterNoun[1]));

  const beforeOrderWord = new RegExp(`(?:^|\\D)(\\d{1,3})\\s+(?:ה)?${ORDER_WORD_PATTERN}`, 'i').exec(text);
  if (beforeOrderWord && hasTransactionListNoun(text)) return clampLimit(Number(beforeOrderWord[1]));

  const detailRequest = new RegExp(`(?:פירוט|תראה|הצג|show|list)\\D{0,30}(\\d{1,3})\\D{0,30}${TRANSACTION_NOUN_PATTERN}`, 'i').exec(text);
  if (detailRequest) return clampLimit(Number(detailRequest[1]));

  return null;
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractHebrewWordLimit = (text) => {
  const entries = [...HEBREW_NUMBER_WORDS.entries()].sort((a, b) => b[0].length - a[0].length);

  for (const [word, value] of entries) {
    const escaped = escapeRegExp(word);
    const beforeNoun = new RegExp(`(?:^|\\s)${escaped}\\s+${TRANSACTION_NOUN_PATTERN}(?:\\s|$)`, 'i').test(text);
    const afterNoun = new RegExp(`${TRANSACTION_NOUN_PATTERN}\\s+${escaped}(?:\\s|$)`, 'i').test(text);
    const beforeOrderWord = new RegExp(`(?:^|\\s)${escaped}\\s+(?:ה)?${ORDER_WORD_PATTERN}(?:\\s|$)`, 'i').test(text);
    const detailRequest = new RegExp(`(?:פירוט|תראה|הצג)\\s+(?:של\\s+)?${escaped}\\s+${TRANSACTION_NOUN_PATTERN}`, 'i').test(text);
    if (beforeNoun || afterNoun || (beforeOrderWord && hasTransactionListNoun(text)) || detailRequest) {
      return clampLimit(value);
    }
  }

  return null;
};

const extractExplicitLimit = (text) => {
  if (!hasTransactionListNoun(text)) return null;
  return extractDigitLimit(text) || extractHebrewWordLimit(text);
};

const detectSortDirection = (text) => {
  if (includesAny(text, [/ראשונות?/, /ראשונים?/, /\bfirst\b/i, /\bearliest\b/i, /\boldest\b/i])) return 'asc';
  if (includesAny(text, [/אחרונות?/, /אחרונים?/, /\blatest\b/i, /\bnewest\b/i, /most\s+recent/i])) return 'desc';
  return null;
};

const extractMonthsAgoCount = (text) => {
  const digit = /לפני\s+(\d{1,2})\s+חודשים?/.exec(text);
  if (digit) return Number(digit[1]);

  for (const [word, value] of HEBREW_NUMBER_WORDS.entries()) {
    if (value > 12) continue;
    const escaped = escapeRegExp(word);
    if (new RegExp(`לפני\\s+${escaped}\\s+חודשים?`).test(text)) return value;
  }

  if (/לפני\s+חודשיים/.test(text)) return 2;
  if (/לפני\s+חודש/.test(text)) return 1;
  return null;
};

const extractLastNMonthsCount = (text) => {
  const digit = /(?:ב|במהלך\s+)?(?:ה)?(\d{1,2})\s+חודשים\s+האחרונים/.exec(text);
  if (digit) return Number(digit[1]);

  if (/בחודשיים\s+האחרונים|במהלך\s+החודשיים\s+האחרונים/.test(text)) return 2;

  for (const [word, value] of HEBREW_NUMBER_WORDS.entries()) {
    if (value > 12) continue;
    const escaped = escapeRegExp(word);
    if (new RegExp(`(?:ב|במהלך\\s+)?(?:ה)?${escaped}\\s+חודשים\\s+האחרונים`).test(text)) return value;
  }

  const english = /(?:last|past)\s+(\d{1,2})\s+months/i.exec(text);
  if (english) return Number(english[1]);
  return null;
};

export const resolveDateRangeFromText = ({ userInput, currentDate }) => {
  const text = normalizeText(userInput);
  const current = parseIsoDateParts(currentDate);
  if (!current) return null;

  const monthsAgo = extractMonthsAgoCount(text);
  if (monthsAgo) {
    const target = addMonths(current, -monthsAgo);
    return calendarMonthRange(target);
  }

  const lastNMonths = extractLastNMonthsCount(text);
  if (lastNMonths) {
    const start = addMonths(current, -(lastNMonths - 1));
    return {
      from: formatDateParts({ year: start.year, month: start.month, day: 1 }),
      to: formatDateParts(current)
    };
  }

  if (includesAny(text, [
    /חודש\s+שעבר/,
    /חודש\s+קודם/,
    /החודש\s+שעבר/,
    /החודש\s+הקודם/,
    /last\s+month/i,
    /previous\s+month/i
  ])) {
    return calendarMonthRange(addMonths(current, -1));
  }

  if (includesAny(text, [
    /(?:^|\s)החודש(?:\s|$)/,
    /חודש\s+נוכחי/,
    /this\s+month/i,
    /מתחילת\s+החודש/
  ])) {
    return currentMonthRange(current);
  }

  return null;
};

export const normalizeTransactionSemanticQuery = ({ userInput, currentDate, semanticQuery }) => {
  if (!semanticQuery || typeof semanticQuery !== 'object') return semanticQuery;

  const text = normalizeText(userInput);
  const normalized = {
    ...semanticQuery,
    filters: { ...(semanticQuery.filters || {}) }
  };

  const explicitLimit = extractExplicitLimit(text);
  const sortDirection = detectSortDirection(text);
  const dateRange = resolveDateRangeFromText({ userInput, currentDate });

  if (isCountQuestion(text)) {
    normalized.aggregation = 'count';
    normalized.limit = null;
    delete normalized.sortDirection;
  } else if (explicitLimit) {
    normalized.aggregation = 'first_n';
    normalized.limit = explicitLimit;
    normalized.sortDirection = sortDirection || normalized.sortDirection || 'desc';
  } else if (sortDirection) {
    normalized.sortDirection = sortDirection;
  }

  if (dateRange) {
    normalized.dateRange = dateRange;
    normalized.timeRange = null;
  }

  if (/ה?העברות?|ה?העברה|transfers?/i.test(text)) {
    normalized.action = 'transfer_money';
    normalized.filters.type = 'transfer';
  }

  return normalized;
};
