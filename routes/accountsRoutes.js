import express from 'express';
import { authenticateToken, requireVerifiedUser } from '../middleware/auth.js';
import ctrl from '../controllers/accountsController.js';

const router = express.Router();

router.get('/me', authenticateToken, requireVerifiedUser, ctrl.getAccount);

export default router;
