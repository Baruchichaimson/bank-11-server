const MAX_LOGGED_CONTENT_CHARS = 2000;

const shouldLogParserDetails = () => (
  process.env.NODE_ENV !== 'production' || process.env.ASSISTANT_DEBUG_ERRORS === 'true'
);

const truncateForLog = (value) => {
  const text = String(value || '');
  if (text.length <= MAX_LOGGED_CONTENT_CHARS) return text;
  return `${text.slice(0, MAX_LOGGED_CONTENT_CHARS)}...`;
};

export const logSemanticParserFailure = ({ reason, error = null, rawContent = '', parsed = null }) => {
  const details = {
    reason,
    error: error?.message || null
  };

  if (shouldLogParserDetails()) {
    details.rawContent = truncateForLog(rawContent);
    if (parsed) details.parsed = parsed;
  }

  console.warn('[assistant:intent-parser] LLM semantic parse failed', details);
};
