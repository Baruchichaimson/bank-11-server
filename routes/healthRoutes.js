import express from 'express';
import { AI_MODEL, AI_PROVIDER, hasAiKey } from '../ai/openaiClient.js';

const router = express.Router();

router.get('/', (_, res) => { res.json({ status: 'OK', time: new Date().toISOString() }); });

router.get('/ai', (_, res) => {
  res.json({
    status: 'OK',
    ai: {
      provider: AI_PROVIDER,
      hasApiKey: hasAiKey,
      model: AI_MODEL
    },
    time: new Date().toISOString()
  });
});

export default router;
