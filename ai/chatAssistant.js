import { OPENAI_MODEL, hasOpenAiKey, openai } from './openaiClient.js';
import { bankTools, executeBankTool } from './bankingTools.js';

const MAX_HISTORY = 12;

const SYSTEM_PROMPT = `
You are a secure banking assistant.
Rules:
- You can answer only about the authenticated user's banking data and product help.
- Never ask for or use userId from user message.
- For account data questions, call tools.
- If user asks for another user's data, refuse.
- If information is unavailable, say so clearly.
- Keep responses concise and practical.
`.trim();

const parseToolArgs = (raw) => {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
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
      reply: 'אני צריך הודעה כדי לעזור לך.',
      nextHistory: history
    };
  }

  if (!hasOpenAiKey || !openai) {
    return {
      reply: 'OPENAI_API_KEY לא מוגדר בשרת, לכן הצ׳אט החכם לא זמין כרגע.',
      nextHistory: history
    };
  }

  const shortHistory = history.slice(-MAX_HISTORY);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...shortHistory,
    { role: 'user', content: trimmed }
  ];

  const first = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.2,
    messages,
    tools: bankTools,
    tool_choice: 'auto'
  });

  const firstMessage = first.choices?.[0]?.message;
  const toolCalls = firstMessage?.tool_calls || [];

  if (!toolCalls.length) {
    const reply = firstMessage?.content || 'לא הצלחתי לייצר תשובה כרגע.';
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
    const result = await executeBankTool({
      name: toolName,
      args: toolArgs,
      userId
    });

    withToolMessages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify(result)
    });
  }

  const second = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.2,
    messages: withToolMessages
  });

  const reply =
    second.choices?.[0]?.message?.content || 'לא הצלחתי לנסח תשובה כרגע.';

  return {
    reply,
    nextHistory: [
      ...shortHistory,
      { role: 'user', content: trimmed },
      { role: 'assistant', content: reply }
    ].slice(-MAX_HISTORY)
  };
};
