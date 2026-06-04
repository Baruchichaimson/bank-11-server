export const sanitizeAssistantText = (text) => {
  return String(text || '')
    .replace(/<function[\s\S]*$/gi, '')
    .replace(/<\/?function[^>]*>/gi, '')
    .replace(/\{[\s\S]*?"name"\s*:\s*"[^"]+"[\s\S]*?\}/gi, '')
    .trim();
};

export const containsToolLeak = (text) => {
  const value = String(text || '').toLowerCase();
  return (
    value.includes('<function') ||
    value.includes('</function') ||
    value.includes('"name"') ||
    value.includes('get_balance') ||
    value.includes('get_user_identity') ||
    value.includes('count_transfers') ||
    value.includes('get_last_transfer') ||
    value.includes('get_recent_transfers')
  );
};
