import { parseQueryWithLlm, validateSemanticQuery } from '../llmSemanticParser.js';
import { normalizeTransactionSemanticQuery } from '../after-llm/transactionQueryNormalizer.js';
import { getCurrentDateForPrompt } from './llmPromptPayloadBuilder.js';

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

const normalizeFinalSemanticQuery = ({ userInput, finalParse }) => {
  if (finalParse.domain !== 'transactions' || finalParse.intent !== 'recent_transactions') {
    return finalParse.semanticQuery;
  }

  const normalized = normalizeTransactionSemanticQuery({
    userInput,
    currentDate: getCurrentDateForPrompt(),
    semanticQuery: finalParse.semanticQuery
  });

  return validateSemanticQuery(normalized) || finalParse.semanticQuery;
};

export const detectIntent = async ({
  userInput,
  history = [],
  createChatCompletion,
  abortSignal
}) => {
  const llmParsed = await parseQueryWithLlm({
    userInput,
    history,
    createChatCompletion,
    abortSignal
  });
  const finalParse =
    llmParsed ||
    (createChatCompletion ? LLM_PARSE_FAILED_PARSE : LLM_UNAVAILABLE_PARSE);
  const semanticQuery = normalizeFinalSemanticQuery({ userInput, finalParse });

  return {
    intent: finalParse.intent,
    confidence: finalParse.confidence,
    domain: finalParse.domain,
    semanticQuery,
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
