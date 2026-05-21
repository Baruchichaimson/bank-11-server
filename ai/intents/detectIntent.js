import { parseQueryFromCurrentMessage } from './queryParser.js';

export const detectIntent = async ({ userInput }) => {
  const parsed = parseQueryFromCurrentMessage(userInput);
  return {
    intent: parsed.intent,
    confidence: parsed.confidence,
    domain: parsed.domain,
    semanticQuery: parsed.semanticQuery,
    source: parsed.source
  };
};
