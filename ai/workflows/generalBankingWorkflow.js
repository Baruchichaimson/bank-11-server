import { parseToolArgs, createReplyPayload, executeToolAndFormat, getOutOfScopeReply } from './shared.js';

const TOOL_SYSTEM_PROMPT = `
You are a secure banking assistant.
Use tools for banking actions and data. Do not invent financial info.
`.trim();

export const handleGeneralBankingWorkflow = async (ctx) => {
  const {
    shortHistory, trimmed, createChatCompletion, bankTools, abortSignal,
    userId, userLanguage, transferState, executeBankTool
  } = ctx;
  const response = await createChatCompletion({
    temperature: 0,
    messages: [
      { role: 'system', content: TOOL_SYSTEM_PROMPT },
      ...shortHistory,
      { role: 'user', content: trimmed }
    ],
    tools: bankTools,
    tool_choice: 'auto',
    abortSignal
  });
  const toolCalls = response?.choices?.[0]?.message?.tool_calls || [];
  if (toolCalls.length > 0) {
    const toolCall = toolCalls[0];
    return executeToolAndFormat({
      name: toolCall.function.name,
      args: parseToolArgs(toolCall.function.arguments),
      userId,
      userLanguage,
      transferState,
      shortHistory,
      userText: trimmed,
      executeBankTool
    });
  }
  return createReplyPayload({
    history: shortHistory,
    userText: trimmed,
    reply: getOutOfScopeReply(userLanguage),
    transferState,
    action: null
  });
};
