import { sanitizeAssistantText } from '../shared/shared.js';
import { inferToolFromUserInput } from '../shared/legacyCompatUtils.js';

const INTENT_SYSTEM_PROMPT = `
You are an intent classifier for a banking assistant.
Return ONLY strict JSON: {"intent":"transfer_money|recent_transactions|check_balance|contact_support|show_personal_details|unknown","confidence":0..1}
No extra text.
`.trim();

const INTENTS = new Set([
  'transfer_money',
  'recent_transactions',
  'check_balance',
  'contact_support',
  'show_personal_details',
  'unknown'
]);

const TOOL_TO_INTENT = {
  open_money_transfer_window: 'transfer_money',
  get_recent_transfers: 'recent_transactions',
  get_last_transfer: 'recent_transactions',
  count_transfers: 'recent_transactions',
  get_last_sent_transfer_to_recipient: 'recent_transactions',
  get_balance: 'check_balance',
  open_video_call_window: 'contact_support',
  get_user_identity: 'show_personal_details'
};

const detectIntentWithoutAi = (userInput) => {
  const inferred = inferToolFromUserInput(userInput);
  return {
    intent: TOOL_TO_INTENT[inferred?.name] || 'unknown',
    confidence: inferred ? 0.65 : 0
  };
};

export const detectIntent = async ({ userInput, history, createChatCompletion, abortSignal }) => {
  if (!createChatCompletion) return detectIntentWithoutAi(userInput);

  const response = await createChatCompletion({
    temperature: 0,
    messages: [
      { role: 'system', content: INTENT_SYSTEM_PROMPT },
      ...history.slice(-4),
      { role: 'user', content: userInput }
    ],
    abortSignal
  });

  const content = sanitizeAssistantText(response?.choices?.[0]?.message?.content);

  try {
    const parsed = JSON.parse(content);
    const intent = INTENTS.has(parsed?.intent) ? parsed.intent : 'unknown';
    const confidence = Number(parsed?.confidence);
    return {
      intent,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0
    };
  } catch {
    const normalized = String(content || '').toLowerCase();
    const fallback = [...INTENTS].find((item) => normalized.includes(item)) || 'unknown';
    return { intent: fallback, confidence: 0.4 };
  }
};
