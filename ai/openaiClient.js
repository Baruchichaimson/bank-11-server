import OpenAI from 'openai';

export const AI_PROVIDER = String(process.env.AI_PROVIDER || 'openai').toLowerCase();

const isOllama = AI_PROVIDER === 'ollama';
const isGroq = AI_PROVIDER === 'groq';

const apiKey = (() => {
  if (isOllama) {
    return process.env.OLLAMA_API_KEY || process.env.OPENAI_API_KEY || 'ollama';
  }

  if (isGroq) {
    return process.env.GROQ_API_KEY || '';
  }

  return process.env.OPENAI_API_KEY || '';
})();

const baseURL = (() => {
  if (isOllama) {
    return process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
  }

  if (isGroq) {
    return process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';
  }

  return process.env.OPENAI_BASE_URL || '';
})();

export const hasOpenAiKey = isOllama ? Boolean(baseURL) : Boolean(apiKey);

export const openai = hasOpenAiKey
  ? new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {})
    })
  : null;

export const OPENAI_MODEL = isOllama
  ? process.env.OLLAMA_MODEL || process.env.OPENAI_MODEL || 'llama3.1'
  : isGroq
    ? process.env.GROQ_MODEL || 'llama-3.1-8b-instant'
    : process.env.OPENAI_MODEL || 'gpt-4o-mini';
export const OPENAI_FALLBACK_MODEL =
  (isOllama
    ? process.env.OLLAMA_FALLBACK_MODEL || process.env.OPENAI_FALLBACK_MODEL
    : isGroq
      ? process.env.GROQ_FALLBACK_MODEL || process.env.OPENAI_FALLBACK_MODEL
    : process.env.OPENAI_FALLBACK_MODEL) || OPENAI_MODEL;
