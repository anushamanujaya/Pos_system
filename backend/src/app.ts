import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import type { RequestHandler } from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { env } from './config/env';
import { connectDb } from './database/connect';
import { errorHandler, notFoundHandler } from './middleware/error';
import { demoRequestGate, demoWritePolicy } from './middleware/demo';
import { apiLimiter } from './middleware/rateLimit';
import { authRouter } from './modules/auth/auth.routes';
import { brandsRouter, categoriesRouter, unitsRouter } from './modules/catalog/catalog.routes';
import { cashRouter } from './modules/cash-registers/cash.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { customersRouter, suppliersRouter } from './modules/parties/parties.routes';
import { productsRouter, uploadDir } from './modules/products/products.routes';
import { purchasesRouter } from './modules/purchases/purchases.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { returnsRouter } from './modules/returns/returns.routes';
import { salesRouter } from './modules/sales/sales.routes';
import {
  auditRouter,
  notificationsRouter,
  promotionsRouter,
  settingsRouter,
} from './modules/settings/settings.routes';
import { usersRouter } from './modules/users/users.routes';
import { logger } from './utils/logger';

type AppOptions = {
  beforeApi?: RequestHandler;
};

export function createApp({ beforeApi }: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.isProd ? 1 : false);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      credentials: true,
      origin: (origin, cb) => {
        // same-origin / curl / server-to-server requests have no Origin header
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        cb(new Error('Origin not allowed by CORS'));
      },
    }),
  );
  app.use(express.json({ limit: '6mb' }));
  app.use(cookieParser());

  if (!env.isTest) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () =>
        logger.info(
          {
            method: req.method,
            url: req.originalUrl.split('?')[0],
            status: res.statusCode,
            ms: Date.now() - start,
          },
          'request',
        ),
      );
      next();
    });
  }

  if (!env.demoMode) app.use(
    '/uploads',
    express.static(uploadDir, {
      maxAge: '7d',
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  app.get('/api/health', (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', db: dbUp ? 'up' : 'down' });
  });

  if (beforeApi) app.use('/api/v1', beforeApi);

  const v1 = express.Router();
  v1.use(apiLimiter);
  v1.use(demoRequestGate);
  v1.use(demoWritePolicy);
  v1.use('/auth', authRouter);
  v1.use('/users', usersRouter);
  v1.use('/products', productsRouter);
  v1.use('/categories', categoriesRouter);
  v1.use('/brands', brandsRouter);
  v1.use('/units', unitsRouter);
  v1.use('/inventory', inventoryRouter);
  v1.use('/suppliers', suppliersRouter);
  v1.use('/purchases', purchasesRouter);
  v1.use('/customers', customersRouter);
  v1.use('/sales', salesRouter);
  v1.use('/returns', returnsRouter);
  v1.use('/cash-registers', cashRouter);
  v1.use('/reports', reportsRouter);
  v1.use('/notifications', notificationsRouter);
  v1.use('/settings', settingsRouter);
  v1.use('/promotions', promotionsRouter);
  v1.use('/audit-logs', auditRouter);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

let databaseConnection: Promise<void> | undefined;

const ensureDatabaseConnection: RequestHandler = (_req, _res, next) => {
  if (mongoose.connection.readyState === 1) {
    next();
    return;
  }

  databaseConnection ??= connectDb().catch((error: unknown) => {
    databaseConnection = undefined;
    throw error;
  });
  void databaseConnection.then(() => next(), next);
};

// Vercel detects this recognized entrypoint and requires the Express application
// itself as the module's default export. The middleware connects once per warm
// instance, while server.ts retains its explicit connection/startup lifecycle.
const app = createApp({ beforeApi: ensureDatabaseConnection });

export default app;
