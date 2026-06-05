import OpenAI from 'openai';

export const AI_PROVIDER = String(
  process.env.AI_PROVIDER || 'openai'
).toLowerCase();

const providers = {
  ollama: {
    apiKey:
      process.env.OLLAMA_API_KEY ||
      process.env.OPENAI_API_KEY ||
      'ollama',

    baseURL:
      process.env.OLLAMA_BASE_URL ||
      'http://localhost:11434/v1',

    model:
      process.env.OLLAMA_MODEL ||
      process.env.OPENAI_MODEL ||
      'llama3.1',

    fallbackModel:
      process.env.OLLAMA_FALLBACK_MODEL ||
      process.env.OPENAI_FALLBACK_MODEL
  },

  groq: {
    apiKey: process.env.GROQ_API_KEY || '',

    baseURL:
      process.env.GROQ_BASE_URL ||
      'https://api.groq.com/openai/v1',

    model:
      process.env.GROQ_MODEL ||
      'llama-3.1-8b-instant',

    fallbackModel:
      process.env.GROQ_FALLBACK_MODEL ||
      process.env.OPENAI_FALLBACK_MODEL
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',

    baseURL: process.env.OPENAI_BASE_URL || '',

    model:
      process.env.OPENAI_MODEL ||
      'gpt-4o-mini',

    fallbackModel:
      process.env.OPENAI_FALLBACK_MODEL
  }
};

const config = providers[AI_PROVIDER] || providers.openai;

export const hasOpenAiKey =
  AI_PROVIDER === 'ollama'
    ? Boolean(config.baseURL)
    : Boolean(config.apiKey);

export const openai = hasOpenAiKey
  ? new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL
        ? { baseURL: config.baseURL }
        : {})
    })
  : null;

export const OPENAI_MODEL = config.model;

export const OPENAI_FALLBACK_MODEL =
  config.fallbackModel || OPENAI_MODEL;