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

const startOfMonth = (year, monthIndex) => new Date(year, monthIndex, 1, 0, 0, 0, 0);
const endOfMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);

export const normalizeTimeRange = ({ timeRange, now = new Date() } = {}) => {
  if (!timeRange) {
    return { startDate: null, endDate: null, label: null };
  }

  const current = new Date(now);
  if (Number.isNaN(current.getTime())) {
    throw new Error('Invalid reference date for time range normalization');
  }

  if (timeRange === 'today') {
    return {
      startDate: startOfDay(current),
      endDate: endOfDay(current),
      label: 'today'
    };
  }

  if (timeRange === 'last_week') {
    const endDate = endOfDay(new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1));
    const startDate = startOfDay(new Date(current.getFullYear(), current.getMonth(), current.getDate() - 7));
    return { startDate, endDate, label: 'last_week' };
  }

  if (timeRange === 'last_month') {
    const year = current.getFullYear();
    const month = current.getMonth();
    const targetMonth = month === 0 ? 11 : month - 1;
    const targetYear = month === 0 ? year - 1 : year;

    return {
      startDate: startOfMonth(targetYear, targetMonth),
      endDate: endOfMonth(targetYear, targetMonth),
      label: 'last_month'
    };
  }

  throw new Error(`Unsupported timeRange: ${timeRange}`);
};
