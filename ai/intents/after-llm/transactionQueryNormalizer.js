const HEBREW_UNITS = new Map([
  ['אחד', 1],
  ['אחת', 1],
  ['ראשון', 1],
  ['ראשונה', 1],
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
  ['תשעת', 9]
]);

const HEBREW_TEENS = new Map([
  ['עשר', 10],
  ['עשרה', 10],
  ['עשרת', 10],
  ['אחד עשר', 11],
  ['אחת עשרה', 11],
  ['שנים עשר', 12],
  ['שתים עשרה', 12],
  ['שתיים עשרה', 12],
  ['שניים עשר', 12],
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
  ['תשע עשרה', 19]
]);

const HEBREW_TENS = new Map([
  ['עשרים', 20],
  ['שלושים', 30],
  ['ארבעים', 40],
  ['חמישים', 50],
  ['שישים', 60],
  ['שבעים', 70],
  ['שמונים', 80],
  ['תשעים', 90],
  ['מאה', 100]
]);

const MAX_LIMIT = 100;
const TRANSACTION_NOUN_PATTERN = '(?:ה?העברות?|ה?העברה|ה?פעולות?|ה?פעולה|ה?טרנזקציות?|ה?טרנזקציה|transfers?|transactions?|activities|activity)';
const ORDER_WORD_PATTERN = '(?:אחרונות|אחרונים|אחרונה|אחרון|ראשונות|ראשונים|ראשונה|ראשון|latest|newest|first|earliest|oldest|most\\s+recent)';
const EXPLICIT_DATE_PATTERN = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?)/g;

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

const validateDateParts = ({ year, month, day }) => {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
};

const daysInMonth = ({ year, month }) => new Date(year, month, 0).getDate();

const addMonths = ({ year, month, day = 1 }, offset) => {
  const date = new Date(year, month - 1 + offset, day);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  };
};

const addDays = ({ year, month, day }, offset) => {
  const date = new Date(year, month - 1, day + offset);
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

const calendarYearRange = (year) => ({
  from: `${year}-01-01`,
  to: `${year}-12-31`
});

const currentYearRange = (currentDate) => ({
  from: `${currentDate.year}-01-01`,
  to: formatDateParts(currentDate)
});

const weekRange = (currentDate, offsetWeeks = 0, throughCurrentDate = false) => {
  const date = new Date(currentDate.year, currentDate.month - 1, currentDate.day);
  const sundayOffset = -date.getDay() + (offsetWeeks * 7);
  const start = addDays(currentDate, sundayOffset);
  const end = throughCurrentDate ? currentDate : addDays(start, 6);
  return {
    from: formatDateParts(start),
    to: formatDateParts(end)
  };
};

const normalizeText = (value) => String(value || '')
  .trim()
  .replace(/[־–—]/g, '-')
  .replace(/["'.,!?;:()[\]{}]/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const normalizeRawText = (value) => String(value || '')
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

const parseNumberToken = (token) => {
  const numeric = Number(token);
  return clampLimit(Number.isInteger(numeric) ? numeric : null);
};

const cleanHebrewNumberPhrase = (phrase) => String(phrase || '')
  .trim()
  .replace(/[־-]/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/^(?:של|את|ה)\s+/, '')
  .trim();

const parseHebrewNumberPhrase = (phrase) => {
  const cleaned = cleanHebrewNumberPhrase(phrase);
  if (!cleaned) return null;

  const directDigit = parseNumberToken(cleaned);
  if (directDigit) return directDigit;

  if (cleaned === 'מאה') return 100;
  if (HEBREW_UNITS.has(cleaned)) return HEBREW_UNITS.get(cleaned);
  if (HEBREW_TEENS.has(cleaned)) return HEBREW_TEENS.get(cleaned);
  if (HEBREW_TENS.has(cleaned)) return HEBREW_TENS.get(cleaned);

  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 2) {
    const [tensWord, rawUnitWord] = parts;
    const unitWord = rawUnitWord.replace(/^ו/, '');
    const tens = HEBREW_TENS.get(tensWord);
    const unit = HEBREW_UNITS.get(unitWord);
    if (tens && tens < 100 && unit) return clampLimit(tens + unit);
  }

  if (parts.length === 3 && parts[1] === 'ו') {
    const tens = HEBREW_TENS.get(parts[0]);
    const unit = HEBREW_UNITS.get(parts[2]);
    if (tens && tens < 100 && unit) return clampLimit(tens + unit);
  }

  return null;
};

const tokenLooksLikeTransactionNoun = (token) => new RegExp(`^${TRANSACTION_NOUN_PATTERN}$`, 'i').test(token);
const tokenLooksLikeOrderWord = (token) => new RegExp(`^${ORDER_WORD_PATTERN}$`, 'i').test(token);

const parseNumberNearToken = ({ tokens, index, direction }) => {
  const windows = direction === 'before'
    ? [4, 3, 2, 1].map((size) => tokens.slice(Math.max(0, index - size), index))
    : [4, 3, 2, 1].map((size) => tokens.slice(index + 1, index + 1 + size));

  for (const window of windows) {
    const parsed = parseHebrewNumberPhrase(window.join(' ')) || parseNumberToken(window.join(' '));
    if (parsed) return parsed;
  }

  return null;
};

const extractDigitLimit = (text) => {
  const beforeNoun = new RegExp(`(?:^|\\D)(\\d{1,3})\\s+${TRANSACTION_NOUN_PATTERN}`, 'i').exec(text);
  if (beforeNoun) return clampLimit(Number(beforeNoun[1]));

  const afterNoun = new RegExp(`${TRANSACTION_NOUN_PATTERN}\\s+(?:ה)?${ORDER_WORD_PATTERN}?\\s*(\\d{1,3})`, 'i').exec(text);
  if (afterNoun) return clampLimit(Number(afterNoun[1]));

  const beforeOrderWord = new RegExp(`(?:^|\\D)(\\d{1,3})\\s+(?:ה)?${ORDER_WORD_PATTERN}`, 'i').exec(text);
  if (beforeOrderWord && hasTransactionListNoun(text)) return clampLimit(Number(beforeOrderWord[1]));

  const detailRequest = new RegExp(`(?:פירוט|תראה|הצג|show|list)\\D{0,40}(\\d{1,3})\\D{0,40}${TRANSACTION_NOUN_PATTERN}`, 'i').exec(text);
  if (detailRequest) return clampLimit(Number(detailRequest[1]));

  return null;
};

const extractHebrewWordLimit = (text) => {
  const tokens = text.split(' ').filter(Boolean);

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokenLooksLikeTransactionNoun(tokens[i]) || tokenLooksLikeOrderWord(tokens[i])) {
      const before = parseNumberNearToken({ tokens, index: i, direction: 'before' });
      if (before && hasTransactionListNoun(text)) return before;

      const after = parseNumberNearToken({ tokens, index: i, direction: 'after' });
      if (after && hasTransactionListNoun(text)) return after;
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

const normalizeYear = (year, currentYear) => {
  if (!Number.isInteger(year)) return currentYear;
  if (year < 100) return 2000 + year;
  return year;
};

const parseLooseDate = ({ value, currentDate }) => {
  const text = String(value || '').trim();

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return validateDateParts({
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3])
    });
  }

  const local = text.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
  if (!local) return null;

  return validateDateParts({
    day: Number(local[1]),
    month: Number(local[2]),
    year: normalizeYear(local[3] ? Number(local[3]) : null, currentDate.year)
  });
};

const rangeFromDates = (fromDate, toDate = fromDate) => {
  if (!fromDate || !toDate) return null;
  if (formatDateParts(fromDate) > formatDateParts(toDate)) {
    return { from: formatDateParts(toDate), to: formatDateParts(fromDate) };
  }
  return { from: formatDateParts(fromDate), to: formatDateParts(toDate) };
};

const extractExplicitDateRange = ({ rawText, currentDate }) => {
  const dates = [...rawText.matchAll(EXPLICIT_DATE_PATTERN)]
    .map((match) => parseLooseDate({ value: match[1], currentDate }))
    .filter(Boolean);

  if (dates.length >= 2) return rangeFromDates(dates[0], dates[1]);

  if (dates.length === 1 && includesAny(rawText, [
    /(?:^|\s)(?:ב|בתאריך|ביום|on)\s*\d/,
    /(?:^|\s)date\s*\d/i
  ])) {
    return rangeFromDates(dates[0]);
  }

  return null;
};

const extractMonthsAgoCount = (text) => {
  const digit = /לפני\s+(\d{1,3})\s+חודשים?/.exec(text);
  if (digit) return clampLimit(Number(digit[1]));

  const tokens = text.split(' ').filter(Boolean);
  const monthIndex = tokens.findIndex((token) => /^חודשים?$/.test(token));
  const beforeBeforeMonth = monthIndex > 0 && tokens[monthIndex - 2] === 'לפני'
    ? parseHebrewNumberPhrase(tokens.slice(monthIndex - 1, monthIndex).join(' '))
      || parseHebrewNumberPhrase(tokens.slice(Math.max(0, monthIndex - 3), monthIndex).join(' '))
    : null;
  if (beforeBeforeMonth) return beforeBeforeMonth;

  if (/לפני\s+חודשיים/.test(text)) return 2;
  if (/לפני\s+חודש/.test(text)) return 1;
  return null;
};

const extractLastNMonthsCount = (text) => {
  const digit = /(?:ב|במהלך\s+)?(?:ה)?(\d{1,3})\s+חודשים\s+האחרונים/.exec(text);
  if (digit) return clampLimit(Number(digit[1]));

  if (/בחודשיים\s+האחרונים|במהלך\s+החודשיים\s+האחרונים/.test(text)) return 2;

  const tokens = text.split(' ').filter(Boolean);
  const monthsIndex = tokens.findIndex((token, index) => /^חודשים$/.test(token) && /^האחרונים$/.test(tokens[index + 1] || ''));
  if (monthsIndex > 0) {
    const parsed = parseHebrewNumberPhrase(tokens.slice(Math.max(0, monthsIndex - 4), monthsIndex).join(' '));
    if (parsed) return parsed;
  }

  const english = /(?:last|past)\s+(\d{1,3})\s+months/i.exec(text);
  if (english) return clampLimit(Number(english[1]));
  return null;
};

export const resolveDateRangeFromText = ({ userInput, currentDate }) => {
  const text = normalizeText(userInput);
  const rawText = normalizeRawText(userInput);
  const current = parseIsoDateParts(currentDate);
  if (!current) return null;

  const explicitDateRange = extractExplicitDateRange({ rawText, currentDate: current });
  if (explicitDateRange) return explicitDateRange;

  if (includesAny(text, [/אתמול/, /yesterday/i])) {
    const yesterday = addDays(current, -1);
    return rangeFromDates(yesterday);
  }

  if (includesAny(text, [/(?:^|\s)היום(?:\s|$)/, /today/i])) {
    return rangeFromDates(current);
  }

  if (includesAny(text, [/שבוע\s+שעבר/, /השבוע\s+שעבר/, /last\s+week/i, /previous\s+week/i])) {
    return weekRange(current, -1, false);
  }

  if (includesAny(text, [/(?:^|\s)השבוע(?:\s|$)/, /this\s+week/i, /מתחילת\s+השבוע/])) {
    return weekRange(current, 0, true);
  }

  if (includesAny(text, [/שנה\s+שעברה/, /השנה\s+שעברה/, /last\s+year/i, /previous\s+year/i])) {
    return calendarYearRange(current.year - 1);
  }

  if (includesAny(text, [/(?:^|\s)השנה(?:\s|$)/, /this\s+year/i, /מתחילת\s+השנה/])) {
    return currentYearRange(current);
  }

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
