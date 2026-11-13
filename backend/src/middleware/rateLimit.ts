import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const common = {
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.isTest,
} as const;

export const loginLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' },
  },
});

export const demoLoginLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many demo access attempts. Try again later.' },
  },
});

export const apiLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: 600,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
});
