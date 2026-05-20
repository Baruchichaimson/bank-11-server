import { sanitizeAssistantText } from './shared.js';

const INTENT_SYSTEM_PROMPT = `
You are an intent classifier for a banking assistant.
Return exactly one label:
transfer_workflow|balance_workflow|transactions_workflow|loan_workflow|support_workflow|general_banking_workflow|out_of_scope_workflow
`.trim();

const INTENT_LABELS = new Set([
  'transfer_workflow',
  'balance_workflow',
  'transactions_workflow',
  'loan_workflow',
  'support_workflow',
  'general_banking_workflow',
  'out_of_scope_workflow'
]);

export const detectWorkflowIntent = async ({ userInput, history, createChatCompletion, abortSignal }) => {
  const response = await createChatCompletion({
    temperature: 0,
    messages: [
      { role: 'system', content: INTENT_SYSTEM_PROMPT },
      ...history.slice(-4),
      { role: 'user', content: userInput }
    ],
    abortSignal
  });
  const content = sanitizeAssistantText(response?.choices?.[0]?.message?.content).toLowerCase();
  if (INTENT_LABELS.has(content)) return content;
  const match = content.match(/(transfer_workflow|balance_workflow|transactions_workflow|loan_workflow|support_workflow|general_banking_workflow|out_of_scope_workflow)/);
  return match?.[1] || 'general_banking_workflow';
};
