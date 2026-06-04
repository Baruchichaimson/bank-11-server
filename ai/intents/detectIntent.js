import { parseQueryWithLlm } from './llmSemanticParser.js';
import { parseQueryLocally } from './localSemanticParser.js';

const UNKNOWN_PARSE = {
  source: 'safe_unknown',
  domain: 'unknown',
  intent: 'unknown',
  confidence: 0,
  semanticQuery: null,
  workflowContinuation: false,
  correction: null,
  transferPayload: null,
  toolName: null,
  toolArgs: {},
  isAmbiguous: false,
  ambiguityReason: null
};

const LLM_UNAVAILABLE_PARSE = {
  ...UNKNOWN_PARSE,
  source: 'llm_unavailable'
};

const LLM_PARSE_FAILED_PARSE = {
  ...UNKNOWN_PARSE,
  source: 'llm_parse_failed'
};

export const detectIntent = async ({
  userInput,
  history = [],
  createChatCompletion,
  abortSignal
}) => {
  const locallyParsed = parseQueryLocally({
    userInput,
    history
  });

  if (locallyParsed) {
    return {
      intent: locallyParsed.intent,
      confidence: locallyParsed.confidence,
      domain: locallyParsed.domain,
      semanticQuery: locallyParsed.semanticQuery,
      source: locallyParsed.source,
      workflowContinuation: Boolean(locallyParsed.workflowContinuation),
      correction: locallyParsed.correction || null,
      transferPayload: locallyParsed.transferPayload || null,
      toolName: locallyParsed.toolName || null,
      toolArgs: locallyParsed.toolArgs || {},
      isAmbiguous: Boolean(locallyParsed.isAmbiguous),
      ambiguityReason: locallyParsed.ambiguityReason || null
    };
  }

  const llmParsed = await parseQueryWithLlm({
    userInput,
    history,
    createChatCompletion,
    abortSignal
  });
  const finalParse =
    llmParsed ||
    (createChatCompletion ? LLM_PARSE_FAILED_PARSE : LLM_UNAVAILABLE_PARSE);

  return {
    intent: finalParse.intent,
    confidence: finalParse.confidence,
    domain: finalParse.domain,
    semanticQuery: finalParse.semanticQuery,
    source: finalParse.source,
    workflowContinuation: Boolean(finalParse.workflowContinuation),
    correction: finalParse.correction || null,
    transferPayload: finalParse.transferPayload || null,
    toolName: finalParse.toolName || null,
    toolArgs: finalParse.toolArgs || {},
    isAmbiguous: Boolean(finalParse.isAmbiguous),
    ambiguityReason: finalParse.ambiguityReason || null
  };
};
