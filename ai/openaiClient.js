import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY || '';

export const hasOpenAiKey = Boolean(apiKey);

export const openai = hasOpenAiKey
  ? new OpenAI({ apiKey })
  : null;

export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
