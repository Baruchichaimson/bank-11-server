import express from 'express';
import { AI_PROVIDER, OPENAI_MODEL, hasOpenAiKey } from '../ai/assistant/openaiClient.js';

const router = express.Router();

router.get('/', (_, res) => { res.json({ status: 'OK', time: new Date().toISOString() }); });

router.get('/ai', (_, res) => {
  res.json({
    status: 'OK',
    ai: {
      provider: AI_PROVIDER,
      hasApiKey: hasOpenAiKey,
      model: OPENAI_MODEL
    },
    time: new Date().toISOString()
  });
});

export default router;
