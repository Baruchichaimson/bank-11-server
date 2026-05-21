export const MAX_HISTORY = 12;

export const detectLanguage = (text) => {
  if (/[\u0590-\u05FF]/.test(text)) return 'he';
  return 'en';
};

export const normalizeIntentText = (text) => String(text || '')
  .toLowerCase()
  .replace(/ך/g, 'כ')
  .replace(/ם/g, 'מ')
  .replace(/ן/g, 'נ')
  .replace(/ף/g, 'פ')
  .replace(/ץ/g, 'צ')
  .replace(/הייתרה|היתרה|יתרה|יתרת/g, 'יתרה')
  .replace(/חוודש|חושד|חודשד/g, 'חודש')
  .replace(/קודםה|קודמ/g, 'קודם');

export const interpretStatelessSemanticQuery = (text) => {
  const value = normalizeIntentText(text);

  const hasAny = (tokens = []) => tokens.some((token) => value.includes(token));
  const pickNumber = () => {
    const match = value.match(/\b(\d{1,3})\b/);
    return match ? Number(match[1]) : null;
  };

  const transferAction = hasAny(['עשיתי העברות', 'ביצעתי העברות', 'העברתי כסף', 'שלחתי כסף', 'העברה', 'העברות']);
  const withdrawAction = hasAny(['משכתי כסף', 'הוצאתי כסף', 'משיכה', 'משכתי']);
  const depositAction = hasAny(['הפקדתי כסף', 'הכנסתי כסף', 'הפקדה', 'הפקדתי']);

  const isProfile = hasAny(['מה השמ שלי', 'מה השם שלי', 'מי אני', 'השם שלי', 'name']);
  const isAccount = hasAny(['יתרה', 'balance', 'מצב חשבון', 'כמה כסף יש לי']);
  const isTransactions = !isProfile && !isAccount;

  const domain = isProfile ? 'profile' : isAccount ? 'account' : 'transactions';
  const intent = domain === 'profile'
    ? (hasAny(['מה השמ שלי', 'מה השם שלי', 'name', 'מי אני']) ? 'get_user_name' : 'get_user_details')
    : domain === 'account'
      ? 'get_balance'
      : 'transactions_query';

  let action = intent;
  let type = null;
  if (domain === 'transactions') {
    if (withdrawAction) {
      action = 'withdraw_money';
      type = 'withdraw';
    } else if (depositAction) {
      action = 'deposit_money';
      type = 'deposit';
    } else if (transferAction) {
      action = 'transfer_money';
      type = 'transfer';
    } else {
      action = 'transfer_money';
      type = 'transfer';
    }
  }

  let timeRange = null;
  if (hasAny(['החודש שעבר', 'בחודש שעבר', 'לפני חודש', 'חודש קודם'])) timeRange = 'last_month';
  else if (hasAny(['השבוע שעבר', 'בשבוע שעבר'])) timeRange = 'last_week';
  else if (hasAny(['היום', 'היומ'])) timeRange = 'today';

  let aggregation = null;
  let limit = null;
  if (domain === 'transactions') {
    if (value.includes('הראשונות')) {
      aggregation = 'first_n';
      limit = pickNumber();
    } else if (value.includes('כמה')) {
      aggregation = 'count';
    } else if (hasAny(['מה היו', 'רשימה'])) {
      aggregation = 'list';
    } else {
      aggregation = 'list';
    }
  }

  return {
    domain,
    intent,
    action,
    filters: { type },
    timeRange,
    aggregation,
    limit
  };
};

export const extractTransferLimit = (normalizedText) => {
  const value = String(normalizedText || '');
  const digitMatch = value.match(/(?:^|\s)(\d{1,3})(?:\s+)?(?:העברה|העברות|transfer|transfers)/);
  if (digitMatch) return Math.min(Math.max(Number(digitMatch[1]), 1), 100);
  const hebrewNumbers = [
    { token: 'אחת', value: 1 }, { token: 'אחד', value: 1 }, { token: 'שתי', value: 2 },
    { token: 'שתיים', value: 2 }, { token: 'שניים', value: 2 }, { token: 'שני', value: 2 },
    { token: 'שלוש', value: 3 }, { token: 'ארבע', value: 4 }, { token: 'חמש', value: 5 }
  ];
  const found = hebrewNumbers.find((x) => value.includes(`${x.token} העברות`) || value.includes(`${x.token} העברה`));
  return found ? found.value : null;
};

export const inferRelativeRange = (normalizedText) => {
  const value = String(normalizedText || '');
  const betweenMatch = value.match(/בין\s+(.+?)\s+(?:לבין|ל|עד)\s+(.+)$/);
  if (betweenMatch) return { from: betweenMatch[1].trim(), to: betweenMatch[2].trim() };
  const fromUntilMatch = value.match(/(?:מ|מתאריך)\s+(.+?)\s+(?:עד|ועד|to)\s+(.+)$/);
  if (fromUntilMatch) return { from: fromUntilMatch[1].trim(), to: fromUntilMatch[2].trim() };
  if (value.includes('מתחילת החודש שעבר') || value.includes('מתחילת חודש שעבר') || value.includes('מתחילת חודש קודם')) return { from: 'start of last month' };
  if (value.includes('עד סוף החודש שעבר') || value.includes('עד סוף חודש שעבר') || value.includes('עד סוף חודש קודם')) return { to: 'end of last month' };
  if (value.includes('מתחילת החודש') || value.includes('מתחילת חודש') || value.includes('from start of month')) return { from: 'start of this month' };
  if (value.includes('עד סוף החודש') || value.includes('עד סוף חודש') || value.includes('to end of month')) return { to: 'end of this month' };
  if (value.includes('מתחילת השנה') || value.includes('from start of year')) return { from: 'start of year' };
  if (value.includes('עד סוף השנה') || value.includes('to end of year')) return { to: 'end of year' };
  if (value.includes('בחודש האחרון') || value.includes('חודש אחרון') || value.includes('חודש קודם') || value.includes('בחודש הקודם') || value.includes('חודש שעבר') || value.includes('last month')) return { from: 'last month' };
  if (value.includes('החודש') || value.includes('בחודש הזה') || value.includes('this month')) return { from: 'this month' };
  return {};
};

export const isRecentTransfersQuery = (normalizedText) => {
  const value = String(normalizedText || '');
  const mentionsTransfers = value.includes('העברה') || value.includes('העברות') || value.includes('transfer');
  const asksForList = ['האחרונות', 'אחרונות', 'recent', 'history', 'היסטוריה', 'הסטוריה', 'תביא', 'תראה', 'show', 'list']
    .some((token) => value.includes(token));
  return mentionsTransfers && asksForList;
};

export const isBalanceQuery = (text) => {
  const value = normalizeIntentText(text);
  return value.includes('balance') || value.includes('יתרה') || value.includes('כמה כסף') || value.includes('מצב חשבון');
};

export const isLikelyBankingQuery = (text) => {
  const value = normalizeIntentText(text);
  return ['balance', 'transfer', 'transfers', 'account', 'status', 'bank', 'יתרה', 'העברה', 'העברות', 'חשבון', 'סטטוס', 'בנק']
    .some((token) => value.includes(token));
};

export const inferToolFromUserInput = (text) => {
  const value = normalizeIntentText(text);
  const rangeArgs = inferRelativeRange(value);
  if (value.includes('video') || value.includes('representative') || value.includes('שיחת וידאו') || value.includes('נציג')) return { name: 'open_video_call_window', args: {} };
  if (value.includes('כמה העברות') || value.includes('כמה העברה') || value.includes('לפני חודש כמה') || value.includes('how many transfers') || value.includes('count transfers')) return { name: 'count_transfers', args: rangeArgs };
  if (value.includes('last transfer') || value.includes('העברה אחרונה')) return { name: 'get_last_transfer', args: {} };
  if (value.includes('recent transfers') || value.includes('transfer history') || value.includes('history of transfers') || value.includes('העברות אחרונות') || value.includes('העברה אחרונה שביצעתי') || value.includes('הסטורית העברות') || value.includes('היסטורית העברות') || value.includes('היסטוריה של העברות') || isRecentTransfersQuery(value)) {
    const limit = extractTransferLimit(value);
    return { name: 'get_recent_transfers', args: { ...rangeArgs, ...(limit ? { limit } : {}) } };
  }
  if (isBalanceQuery(value)) return { name: 'get_balance', args: {} };
  if (value.includes('מי אני') || value.includes('who am i') || value.includes('my email') || value.includes('האימייל שלי')) return { name: 'get_user_identity', args: {} };
  if (value.includes('send money') || value.includes('make transfer') || value.includes('new transfer') || value.includes('בצע העברה') || value.includes('להעביר כסף') || value.includes('העברה חדשה') || value.includes('שלח כסף')) return { name: 'open_money_transfer_window', args: {} };
  return null;
};

export const inferHighConfidenceTool = (text) => {
  const value = normalizeIntentText(text);
  const rangeArgs = inferRelativeRange(value);
  if (value.includes('כמה העברות') || value.includes('כמה העברה') || value.includes('לפני חודש כמה') || value.includes('how many transfers') || value.includes('count transfers')) return { name: 'count_transfers', args: rangeArgs };
  if (value.includes('last transfer') || value.includes('העברה אחרונה') || value.includes('תביא לי את העברה האחרונה') || value.includes('תביאי לי את העברה האחרונה')) {
    if (rangeArgs.from === 'last month') return { name: 'get_recent_transfers', args: { from: 'last month', limit: 1 } };
    return { name: 'get_last_transfer', args: {} };
  }
  if (value.includes('2 העברות האחרונות') || value.includes('שתי העברות האחרונות') || value.includes('שני העברות האחרונות') || value.includes('recent transfers') || value.includes('transfer history') || value.includes('history of transfers') || value.includes('העברות אחרונות') || value.includes('הסטורית העברות') || value.includes('היסטורית העברות') || value.includes('היסטוריה של העברות') || isRecentTransfersQuery(value)) {
    const limit = extractTransferLimit(value);
    return { name: 'get_recent_transfers', args: { ...rangeArgs, ...(limit ? { limit } : {}) } };
  }
  if (isBalanceQuery(value)) return { name: 'get_balance', args: {} };
  return null;
};

export const getLastUserMessage = (history = []) => {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === 'user') return String(history[i]?.content || '');
  }
  return '';
};

export const getLastAssistantMessage = (history = []) => {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === 'assistant') return String(history[i]?.content || '');
  }
  return '';
};

export const extractFoundTransfersCountFromAssistant = (text) => {
  const value = String(text || '');
  const he = value.match(/מצאתי עבורך\s+(\d+)\s+העברות/);
  if (he) return Number(he[1]);
  const en = value.match(/i found\s+(\d+)\s+recent transfers/i);
  if (en) return Number(en[1]);
  return null;
};

export const extractRequestedCountFromComplaint = (text) => {
  const value = normalizeIntentText(text);
  const digitMatch = value.match(/ביקשתי\s+(\d{1,3})/);
  if (digitMatch) return Number(digitMatch[1]);
  return extractTransferLimit(value);
};

export const extractPersonNameQuery = (text) => {
  const value = normalizeIntentText(text);
  const match = value.match(/(?:מי זה|who is)\s+([^\s?.,!]+)/);
  return match ? match[1].trim() : '';
};

export const inferFollowupToolFromHistory = (text, history = []) => {
  const value = normalizeIntentText(text);
  const rangeArgs = inferRelativeRange(value);
  const lastUser = normalizeIntentText(getLastUserMessage(history));
  const lastAssistant = getLastAssistantMessage(history);
  const requestedInCurrent = extractTransferLimit(value);
  const requestedInPrevious = extractTransferLimit(lastUser);
  const inheritedLimit = requestedInCurrent || requestedInPrevious;
  if (value.includes('של חודש קודם') || value.includes('של חודש שעבר') || value.includes('בחודש קודם') || value.includes('בחודש שעבר')) {
    return { name: 'get_recent_transfers', args: { from: 'last month', ...(inheritedLimit ? { limit: inheritedLimit } : {}) } };
  }
  if (isRecentTransfersQuery(value) && inheritedLimit && Object.keys(rangeArgs).length > 0) {
    return { name: 'get_recent_transfers', args: { ...rangeArgs, limit: inheritedLimit } };
  }
  const personName = extractPersonNameQuery(text);
  if (personName) return { name: 'get_last_sent_transfer_to_recipient', args: { recipientName: personName } };
  if (value.includes('אבל ביקשתי')) return { name: '__complaint_requested_count__', args: {} };
  if ((value === 'אבל' || value.includes('אבל')) && (lastAssistant.includes('העברה') || lastAssistant.toLowerCase().includes('transfer'))) {
    const lastRange = inferRelativeRange(lastUser);
    if (Object.keys(lastRange).length > 0 || requestedInPrevious) {
      return { name: 'get_recent_transfers', args: { ...lastRange, ...(requestedInPrevious ? { limit: requestedInPrevious } : {}) } };
    }
  }
  return null;
};
