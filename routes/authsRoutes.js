import express from 'express';
import controller from '../controllers/authsController.js';
import {
  authForgotPasswordLimiter,
  authLoginLimiter,
  authResetPasswordLimiter,
  authSignupLimiter
} from '../middleware/rateLimit.js';

const router = express.Router();

router.post('/signup', authSignupLimiter, controller.signup);
router.post('/login', authLoginLimiter, controller.login);
router.get('/verify', controller.verify);
router.post('/logout', controller.logout);
router.post('/forgot-password', authForgotPasswordLimiter, controller.forgotPassword);
router.get('/reset-password/:token', controller.openResetPasswordPage);
router.get('/reset-password', controller.openResetPasswordPage);
router.post('/reset-password', authResetPasswordLimiter, controller.resetPassword);
router.get('/verify-status', controller.verifyStatus);

export default router;
