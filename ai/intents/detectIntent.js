import { parseQueryFromCurrentMessage } from './queryParser.js';
import { parseQueryWithLlm } from './llmSemanticParser.js';

const shouldTryLlmFallback = (parsed, userInput) => {
  if (!parsed || parsed.domain === 'unknown') return true;
  const query = parsed.semanticQuery;
  const hasDigit = /\d/.test(String(userInput || ''));
  return (
    parsed.domain === 'transactions'
    && query
    && query.aggregation !== 'count'
    && (query.limit === null || !hasDigit)
  );
};

export const detectIntent = async ({ userInput, createChatCompletion, abortSignal }) => {
  const parsed = parseQueryFromCurrentMessage(userInput);
  const llmParsed = shouldTryLlmFallback(parsed, userInput)
    ? await parseQueryWithLlm({ userInput, createChatCompletion, abortSignal })
    : null;
  const finalParse = llmParsed || parsed;

  return {
    intent: finalParse.intent,
    confidence: finalParse.confidence,
    domain: finalParse.domain,
    semanticQuery: finalParse.semanticQuery,
    source: finalParse.source
  };
};
