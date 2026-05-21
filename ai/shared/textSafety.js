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
    value.includes('function') ||
    value.includes('tool') ||
    value.includes('get_balance') ||
    value.includes('get_user_identity') ||
    value.includes('count_transfers') ||
    value.includes('get_last_transfer') ||
    value.includes('get_recent_transfers')
  );
};

export const getOutOfScopeReply = (userLanguage) => (
  userLanguage === 'he'
    ? 'אני עוזר רק בנושאי בנקאות. אפשר לשאול על יתרה, העברות, סטטוס חשבון, או לבקש פתיחת חלון שיחת וידאו/העברה.'
    : 'I can help only with banking topics. Ask about balance, transfers, account status, or opening the video-call/transfer window.'
);
