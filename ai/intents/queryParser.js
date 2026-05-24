import { normalizeIntentText, interpretStatelessSemanticQuery } from '../shared/legacyCompatUtils.js';

const INTENT_BY_DOMAIN = {
  profile: 'show_personal_details',
  account: 'check_balance',
  transactions: 'recent_transactions'
};

const SUPPORT_TOKENS = [
  'representative', 'video call', 'support', 'agent',
  'נציג', 'תמיכה', 'שיחת וידאו'
];

const TRANSFER_TOKENS = [
  'send money', 'new transfer', 'make transfer',
  'בצע העברה', 'תבצע לי העברה', 'תעביר לי', 'להעביר כסף', 'רוצה להעביר',
  'איכ מבצעימ העברה', 'איכ לבצע העברה', 'איכ עושימ העברה',
  'העברה חדשה', 'שלח כסף'
];

const TRANSACTION_HISTORY_TOKENS = [
  'recent transfers', 'transfer history', 'history of transfers',
  'last transfer', 'how many transfers', 'count transfers',
  'העברות אחרונות', 'העברה אחרונה', 'היסטורית העברות', 'הסטורית העברות',
  'היסטוריה של העברות', 'כמה העברות', 'כמה העברה',
  'העברות האחרונות', 'העברות הראשונות', 'האחרונות', 'הראשונות',
  'מה היו', 'רשימה', 'עשיתי העברות', 'ביצעתי העברות', 'העברתי כסף',
  'שלחתי כסף', 'חודש קודם', 'בחודש שעבר', 'השבוע שעבר', 'החודש', 'היום'
];

const hasAny = (value, tokens) => tokens.some((token) => value.includes(token));

const TRANSFER_CONTROL_TOKENS = [
  'yes', 'no', 'cancel', 'confirm', 'approve',
  'כן', 'כנ', 'לא', 'בטל', 'אישור', 'מאשר'
];

export const isTransferControlMessage = (userInput) => {
  const normalized = normalizeIntentText(String(userInput || '').trim());
  if (!normalized) return false;
  if (hasAny(normalized, TRANSFER_CONTROL_TOKENS)) return true;
  if (/^\d+(\.\d+)?$/.test(normalized)) return true;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return true;
  return false;
};

export const parseQueryFromCurrentMessage = (userInput) => {
  const raw = String(userInput || '').trim();
  const normalized = normalizeIntentText(raw);

  if (!normalized) {
    return {
      source: 'current_message_only',
      domain: 'unknown',
      intent: 'unknown',
      confidence: 0,
      semanticQuery: null
    };
  }

  if (hasAny(normalized, SUPPORT_TOKENS)) {
    return {
      source: 'current_message_only',
      domain: 'support',
      intent: 'contact_support',
      confidence: 1,
      semanticQuery: null
    };
  }

  if (hasAny(normalized, TRANSFER_TOKENS)) {
    return {
      source: 'current_message_only',
      domain: 'transactions',
      intent: 'transfer_money',
      confidence: 1,
      semanticQuery: null
    };
  }

  const semanticQuery = interpretStatelessSemanticQuery(normalized);
  if (semanticQuery?.domain === 'profile' || semanticQuery?.domain === 'account') {
    const domain = semanticQuery.domain;
    return {
      source: 'current_message_only',
      domain,
      intent: INTENT_BY_DOMAIN[domain],
      confidence: 0.95,
      semanticQuery
    };
  }

  if (!hasAny(normalized, TRANSACTION_HISTORY_TOKENS)) {
    return {
      source: 'current_message_only',
      domain: 'unknown',
      intent: 'unknown',
      confidence: 0,
      semanticQuery: null
    };
  }

  const domain = semanticQuery?.domain || 'unknown';
  const intent = INTENT_BY_DOMAIN[domain] || 'unknown';

  return {
    source: 'current_message_only',
    domain,
    intent,
    confidence: intent === 'unknown' ? 0 : 0.95,
    semanticQuery
  };
};
