import {
  ACTION_TO_TYPE,
  TYPE_TO_ACTION,
  ALLOWED_ACTIONS as ALLOWED_ACTION_VALUES,
  ALLOWED_AGGREGATIONS as ALLOWED_AGGREGATION_VALUES,
  ALLOWED_TIME_RANGES as ALLOWED_TIME_RANGE_VALUES,
  ALLOWED_TYPES as ALLOWED_TYPE_VALUES
} from '../before-llm/semanticCatalog.js';
import {
  normalizeNullableValue,
  normalizeStringField
} from './llmValueNormalizers.js';

const ALLOWED_ACTIONS = new Set(ALLOWED_ACTION_VALUES);
const ALLOWED_TYPES = new Set(ALLOWED_TYPE_VALUES);
const ALLOWED_TIME_RANGES = new Set(ALLOWED_TIME_RANGE_VALUES);
const ALLOWED_AGGREGATIONS = new Set(ALLOWED_AGGREGATION_VALUES);
const ALLOWED_SORT_DIRECTIONS = new Set(['asc', 'desc']);
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const clampLimit = (value) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 100) return null;
  return numeric;
};

const normalizeActionAndType = ({ action: rawAction, type: rawType }) => {
  let action = normalizeNullableValue(rawAction);
  let type = normalizeNullableValue(rawType);

  action = ALLOWED_ACTIONS.has(action) ? action : null;
  type = ALLOWED_TYPES.has(type) ? type : null;

  if (action) {
    type = ACTION_TO_TYPE[action];
  } else if (type) {
    action = TYPE_TO_ACTION[type];
  }

  return { action, type };
};

const normalizeIsoDateField = (value) => {
  const text = normalizeStringField(value);
  if (!text) return null;

  const match = text.match(ISO_DATE_PATTERN);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }

  return text;
};

const hasDateRangeInput = (dateRange) => Boolean(
  dateRange
    && typeof dateRange === 'object'
    && !Array.isArray(dateRange)
    && (dateRange.from || dateRange.to)
);

const validateDateRange = (dateRange) => {
  if (!hasDateRangeInput(dateRange)) return null;

  const from = normalizeIsoDateField(dateRange.from);
  const to = normalizeIsoDateField(dateRange.to);
  if ((dateRange.from && !from) || (dateRange.to && !to)) return null;
  if (!from && !to) return null;
  if (from && to && from > to) return null;

  return { from, to };
};

export const validateSemanticQuery = (semanticQuery) => {
  if (!semanticQuery || typeof semanticQuery !== 'object') return null;
  if (semanticQuery.domain !== 'transactions') return null;
  if (semanticQuery.intent !== 'transactions_query') return null;

  const { action, type } = normalizeActionAndType({
    action: semanticQuery.action,
    type: semanticQuery.filters?.type
  });
  const normalizedTimeRange = normalizeNullableValue(semanticQuery.timeRange);
  const timeRange = ALLOWED_TIME_RANGES.has(normalizedTimeRange) ? normalizedTimeRange : null;
  const dateRange = validateDateRange(semanticQuery.dateRange);
  if (hasDateRangeInput(semanticQuery.dateRange) && !dateRange) return null;
  const aggregation = ALLOWED_AGGREGATIONS.has(semanticQuery.aggregation) ? semanticQuery.aggregation : 'list';
  const sortDirection = ALLOWED_SORT_DIRECTIONS.has(semanticQuery.sortDirection) ? semanticQuery.sortDirection : null;
  const recipientName = normalizeStringField(semanticQuery.recipientName);

  if (aggregation === 'counterparty' && !recipientName) return null;

  const result = {
    domain: 'transactions',
    intent: 'transactions_query',
    action,
    filters: { type },
    timeRange: dateRange ? null : timeRange,
    aggregation,
    limit: aggregation === 'count' ? null : clampLimit(semanticQuery.limit)
  };

  if (dateRange) result.dateRange = dateRange;
  if (sortDirection) result.sortDirection = sortDirection;
  if (recipientName) result.recipientName = recipientName;
  return result;
};
