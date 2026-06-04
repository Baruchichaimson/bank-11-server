import {
  ALLOWED_CONFIRMATIONS as ALLOWED_CONFIRMATION_VALUES,
  ALLOWED_CORRECTION_FIELDS as ALLOWED_CORRECTION_FIELD_VALUES
} from './semanticCatalog.js';
import {
  normalizeNullableValue,
  normalizeStringField
} from './llmValueNormalizers.js';

const ALLOWED_CORRECTION_FIELDS = new Set(ALLOWED_CORRECTION_FIELD_VALUES);
const ALLOWED_CONFIRMATIONS = new Set(ALLOWED_CONFIRMATION_VALUES);
const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export const validateCorrection = (correction) => {
  if (!correction || typeof correction !== 'object') return null;
  const field = ALLOWED_CORRECTION_FIELDS.has(correction.field) ? correction.field : 'unknown';
  const value = ['string', 'number'].includes(typeof correction.value) ? correction.value : null;
  return { field, value };
};

const normalizeEmailField = (value) => {
  const email = normalizeStringField(value);
  if (!email) return null;
  const lower = email.toLowerCase();
  return EMAIL_PATTERN.test(lower) ? lower : null;
};

const normalizeAmountField = (value) => {
  const normalized = normalizeNullableValue(value);
  if (normalized === null) return null;
  const amount = Number(String(normalized).replace(/,/g, '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
};

export const validateTransferPayload = (transferPayload) => {
  if (!transferPayload || typeof transferPayload !== 'object') return null;

  const confirmationValue = normalizeNullableValue(transferPayload.confirmation);
  const confirmation = ALLOWED_CONFIRMATIONS.has(confirmationValue) ? confirmationValue : null;
  const result = {
    receiverEmail: normalizeEmailField(transferPayload.receiverEmail),
    amount: normalizeAmountField(transferPayload.amount),
    description: normalizeStringField(transferPayload.description),
    confirmation,
    skipDescription: Boolean(transferPayload.skipDescription),
    startNewTransfer: Boolean(transferPayload.startNewTransfer)
  };

  const hasMeaningfulValue = Object.values(result).some((value) => (
    value !== null && value !== false
  ));
  return hasMeaningfulValue ? result : null;
};

export const validateToolArgs = (toolArgs) => {
  if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) return {};
  const recipientName = normalizeStringField(toolArgs.recipientName);
  return recipientName ? { recipientName } : {};
};
