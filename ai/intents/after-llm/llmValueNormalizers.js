export const normalizeNullableValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim().toLowerCase() === 'null') return null;
  return value;
};

export const normalizeEnumString = (value) => {
  const normalized = normalizeNullableValue(value);
  if (typeof normalized !== 'string') return normalized;
  return normalized.trim().toLowerCase();
};

export const normalizeStringField = (value) => {
  const normalized = normalizeNullableValue(value);
  if (typeof normalized !== 'string') return null;
  const trimmed = normalized.trim();
  return trimmed || null;
};

export const normalizeConfidenceField = (value) => {
  if (value === null || value === undefined) return null;
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return null;
  return Math.min(Math.max(confidence, 0), 1);
};
