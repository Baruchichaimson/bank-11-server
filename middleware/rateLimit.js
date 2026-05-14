import rateLimit from 'express-rate-limit';

const ONE_MINUTE_MS = 60 * 1000;
const retryMessage = 'יToo many attempts. You can continue trying again in one minute.';

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const buildLimiter = ({ max, keyGenerator }) =>
  rateLimit({
    windowMs: ONE_MINUTE_MS,
    max,
    keyGenerator,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message: retryMessage
    }
  });

const userAndIpKey = (req) => {
  const email = normalizeEmail(req.body?.email);
  const ip = String(req.ip || 'unknown-ip');
  return `${ip}:${email || 'unknown-email'}`;
};

export const authLoginLimiter = buildLimiter({
  max: 5,
  keyGenerator: userAndIpKey
});
export const authSignupLimiter = buildLimiter({
  max: 5,
  keyGenerator: userAndIpKey
});
export const authForgotPasswordLimiter = buildLimiter({
  max: 3
});
export const authResetPasswordLimiter = buildLimiter({
  max: 3
});
