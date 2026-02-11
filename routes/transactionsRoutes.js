import express from 'express';
import controller from '../controllers/transactionsController.js';
import { authenticateToken, requireVerifiedUser } from '../middleware/auth.js';

const router = express.Router();

router.post('/', authenticateToken, requireVerifiedUser, controller.createTransaction);
router.get('/', authenticateToken, requireVerifiedUser, controller.getTransactions);
router.get('/by-recipient-name/:recipientName',authenticateToken,requireVerifiedUser,controller.getSentTransactionByRecipientName);
router.get('/:transactionId', authenticateToken, requireVerifiedUser, controller.getTransactionById);

export default router;
