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
  'בצע העברה', 'להעביר כסף', 'העברה חדשה', 'שלח כסף'
];

const hasAny = (value, tokens) => tokens.some((token) => value.includes(token));

const TRANSFER_CONTROL_TOKENS = [
  'yes', 'no', 'cancel', 'confirm', 'approve',
  'כן', 'לא', 'בטל', 'אישור', 'מאשר'
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
