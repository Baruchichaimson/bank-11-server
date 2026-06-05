const startOfDay = (date) => {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
};

const endOfDay = (date) => {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
};

const buildIsoDate = ({ year, month, day }) => {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }

  return date;
};

const parseIsoDate = (value) => {
  if (!value) return null;

  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  return buildIsoDate({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  });
};

const hasDateRangeInput = (dateRange) => Boolean(
  dateRange
    && typeof dateRange === 'object'
    && !Array.isArray(dateRange)
    && (dateRange.from || dateRange.to)
);

export const normalizeTimeRange = ({ dateRange = null } = {}) => {
  if (!hasDateRangeInput(dateRange)) {
    return { startDate: null, endDate: null, label: null };
  }

  const fromDate = parseIsoDate(dateRange.from);
  const toDate = parseIsoDate(dateRange.to);
  if ((dateRange.from && !fromDate) || (dateRange.to && !toDate)) {
    throw new Error('Invalid date range');
  }

  const startDate = fromDate ? startOfDay(fromDate) : null;
  const endDate = toDate ? endOfDay(toDate) : null;
  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    throw new Error('Invalid date range');
  }

  return {
    startDate,
    endDate,
    label: 'date_range'
  };
};
