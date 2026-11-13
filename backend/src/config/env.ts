import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/supermarket_pos?replicaSet=rs0'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** Refresh cookie `Secure` flag. Defaults to on in production; set false ONLY for plain-HTTP local demos. */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  LOG_LEVEL: z.string().default('info'),
  UPLOAD_DIR: z.string().default('uploads'),
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_NAME: z.string().default('Store Owner'),
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  DEMO_DATABASE_NAME: z.string().trim().min(1).optional(),
  DEMO_DATABASE_ID: z.string().min(16).optional(),
  DEMO_ACCOUNT_PASSWORD: z.string().min(16).optional(),
});

const parsed = schema.safeParse(
  process.env.NODE_ENV === 'test'
    ? { JWT_ACCESS_SECRET: 'test-secret-test-secret', ...process.env }
    : process.env,
);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
  cookieSecure: parsed.data.COOKIE_SECURE
    ? parsed.data.COOKIE_SECURE === 'true'
    : parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  demoMode: parsed.data.DEMO_MODE === 'true',
};
