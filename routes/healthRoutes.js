import express from 'express';

const router = express.Router();

router.get('/', (_, res) => { res.json({ status: 'OK', time: new Date().toISOString() }); });

export default router;
