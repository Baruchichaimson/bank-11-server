import { OPENAI_MODEL, hasOpenAiKey, openai } from './openaiClient.js';
import { bankTools, executeBankTool } from './bankingTools.js';

const MAX_HISTORY = 12;
const FALLBACK_MODEL = 'gpt-4o-mini';

const SYSTEM_PROMPT = `
You are a secure banking assistant.
Rules:
- You can answer only about the authenticated user's banking data and product help.
- Never ask for or use userId from user message.
- For account data questions, call tools.
- If user asks for another user's data, refuse.
- If information is unavailable, say so clearly.
- Keep responses concise and practical.
- Always answer in English.
`.trim();

const parseToolArgs = (raw) => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const isModelIssue = (err) => {
  const code = String(err?.code || err?.error?.code || '').toLowerCase();
  const message = String(err?.message || err?.error?.message || '').toLowerCase();
  return (
    code.includes('model') ||
    message.includes('model') ||
    message.includes('does not exist')
  );
};

const createChatCompletion = async (payload) => {
  try {
    return await openai.chat.completions.create({
      model: OPENAI_MODEL,
      ...payload
    });
  } catch (err) {
    if (!isModelIssue(err) || OPENAI_MODEL === FALLBACK_MODEL) {
      throw err;
    }

    return openai.chat.completions.create({
      model: FALLBACK_MODEL,
      ...payload
    });
  }
};

export const generateAssistantReply = async ({
  userInput,
  userId,
  history = []
}) => {
  const trimmed = String(userInput || '').trim();
  if (!trimmed) {
    return {
      reply: 'Please type a message so I can help.',
      nextHistory: history
    };
  }

  if (!hasOpenAiKey || !openai) {
    return {
      reply: 'OPENAI_API_KEY is missing on the server, so the assistant is currently unavailable.',
      nextHistory: history
    };
  }

  const shortHistory = history.slice(-MAX_HISTORY);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...shortHistory,
    { role: 'user', content: trimmed }
  ];

  try {
    const first = await createChatCompletion({
      temperature: 0.2,
      messages,
      tools: bankTools,
      tool_choice: 'auto'
    });

    const firstMessage = first.choices?.[0]?.message;
    const toolCalls = firstMessage?.tool_calls || [];

    if (!toolCalls.length) {
      const reply = firstMessage?.content || 'I could not generate a response right now.';
      return {
        reply,
        nextHistory: [
          ...shortHistory,
          { role: 'user', content: trimmed },
          { role: 'assistant', content: reply }
        ].slice(-MAX_HISTORY)
      };
    }

    const withToolMessages = [...messages, firstMessage];

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name || '';
      const toolArgs = parseToolArgs(toolCall.function?.arguments);
      let result;

      try {
        result = await executeBankTool({
          name: toolName,
          args: toolArgs,
          userId
        });
      } catch (toolErr) {
        result = {
          found: false,
          message: `Tool execution failed for ${toolName}`,
          details: String(toolErr?.message || toolErr)
        };
      }

      withToolMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result)
      });
    }

    const second = await createChatCompletion({
      temperature: 0.2,
      messages: withToolMessages
    });

    const reply =
      second.choices?.[0]?.message?.content || 'I could not phrase a response right now.';

    return {
      reply,
      nextHistory: [
        ...shortHistory,
        { role: 'user', content: trimmed },
        { role: 'assistant', content: reply }
      ].slice(-MAX_HISTORY)
    };
  } catch (err) {
    const details = String(err?.message || err);
    throw new Error(`Assistant generation failed: ${details}`);
  }
};
