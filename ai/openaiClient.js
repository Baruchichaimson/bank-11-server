import OpenAI from 'openai';

export const AI_PROVIDER = String(process.env.AI_PROVIDER || 'openai').toLowerCase();

const isOllama = AI_PROVIDER === 'ollama';
const isGrok = AI_PROVIDER === 'grok' || AI_PROVIDER === 'xai';

const apiKey = (() => {
  if (isOllama) {
    return process.env.OLLAMA_API_KEY || process.env.OPENAI_API_KEY || 'ollama';
  }

  if (isGrok) {
    return process.env.XAI_API_KEY || process.env.GROK_API_KEY || '';
  }

  return process.env.OPENAI_API_KEY || '';
})();

const baseURL = (() => {
  if (isOllama) {
    return process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
  }

  if (isGrok) {
    return process.env.XAI_BASE_URL || process.env.GROK_BASE_URL || 'https://api.x.ai/v1';
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
  : isGrok
    ? process.env.GROK_MODEL || process.env.XAI_MODEL || 'grok-2-latest'
    : process.env.OPENAI_MODEL || 'gpt-4o-mini';
export const OPENAI_FALLBACK_MODEL =
  (isOllama
    ? process.env.OLLAMA_FALLBACK_MODEL || process.env.OPENAI_FALLBACK_MODEL
    : isGrok
      ? process.env.GROK_FALLBACK_MODEL || process.env.XAI_FALLBACK_MODEL || process.env.OPENAI_FALLBACK_MODEL
    : process.env.OPENAI_FALLBACK_MODEL) || OPENAI_MODEL;
