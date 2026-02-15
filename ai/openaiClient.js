import OpenAI from 'openai';

const normalized = (value, fallback = '') =>
  String(value || fallback).trim();

export const AI_PROVIDER = normalized(
  process.env.AI_PROVIDER,
  process.env.GROK_API_KEY ? 'grok' : 'openai'
).toLowerCase();

const providerConfig = {
  openai: {
    apiKey: normalized(process.env.AI_API_KEY, process.env.OPENAI_API_KEY),
    model: normalized(process.env.AI_MODEL, process.env.OPENAI_MODEL || 'gpt-4o-mini'),
    baseURL: normalized(process.env.AI_BASE_URL, process.env.OPENAI_BASE_URL)
  },
  grok: {
    apiKey: normalized(process.env.AI_API_KEY, process.env.GROK_API_KEY),
    model: normalized(process.env.AI_MODEL, process.env.GROK_MODEL || 'grok-2-latest'),
    baseURL: normalized(process.env.AI_BASE_URL, process.env.GROK_BASE_URL || 'https://api.x.ai/v1')
  }
};

const activeConfig = providerConfig[AI_PROVIDER] || providerConfig.openai;

const apiKey = activeConfig.apiKey;
const baseURL = activeConfig.baseURL;

export const hasAiKey = Boolean(apiKey);

export const aiClient = hasAiKey
  ? new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {})
    })
  : null;

export const AI_MODEL = activeConfig.model;
export const AI_FALLBACK_MODEL = normalized(
  process.env.AI_FALLBACK_MODEL,
  AI_PROVIDER === 'openai' ? 'gpt-4o-mini' : ''
);

// Backward-compatible exports used by existing modules.
export const hasOpenAiKey = hasAiKey;
export const openai = aiClient;
export const OPENAI_MODEL = AI_MODEL;
