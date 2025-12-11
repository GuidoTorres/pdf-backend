import rateLimit from 'express-rate-limit';

const isTestEnv = process.env.NODE_ENV === 'test';

const baseLimiterOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isTestEnv || req.path.startsWith('/webhooks'),
};

export const generalLimiter = rateLimit({
  ...baseLimiterOptions,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
});

export const authLimiter = rateLimit({
  ...baseLimiterOptions,
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    error: 'Too many authentication attempts, please try again later.',
  },
});

export default {
  generalLimiter,
  authLimiter,
};
