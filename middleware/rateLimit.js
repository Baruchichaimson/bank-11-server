import rateLimit from 'express-rate-limit';

const ONE_MINUTE_MS = 60 * 1000;
const retryMessage = 'Too many attempts. You can continue trying again in one minute.';

const buildLimiter = (max) =>
  rateLimit({
    windowMs: ONE_MINUTE_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: retryMessage
    }
  });

export const authLoginLimiter = buildLimiter(5);
export const authForgotPasswordLimiter = buildLimiter(3);
export const authResetPasswordLimiter = buildLimiter(3);
export const authSignupLimiter = buildLimiter(5);
