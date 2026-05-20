import { createReplyPayload } from './shared.js';

export const handleLoanWorkflow = async (ctx) => {
  const { userLanguage, shortHistory, trimmed, transferState } = ctx;
  const reply = userLanguage === 'he'
    ? 'אני יכול לעזור במידע כללי על הלוואות: סכומים, תקופות החזר, וריבית משוערת לפי פרופיל. אם תרצה, כתוב סכום מבוקש ותקופת החזר ואחשב עבורך דוגמה.'
    : 'I can help with general loan information: amount ranges, repayment terms, and estimated interest by profile. If you want, share amount and term and I will calculate an example.';
  return createReplyPayload({
    history: shortHistory,
    userText: trimmed,
    reply,
    transferState,
    action: null
  });
};
