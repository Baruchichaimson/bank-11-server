import express from 'express';
import controller from '../controllers/authsController.js';

const router = express.Router();

router.post('/signup', controller.signup);
router.post('/login', controller.login);
router.get('/verify', controller.verify);
router.post('/logout', controller.logout);
router.post('/forgot-password', controller.forgotPassword);
router.post('/reset-password', controller.resetPassword);
router.get('/verify-status', controller.verifyStatus);

export default router;
