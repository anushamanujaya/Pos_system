import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { DemoControl } from '../database/models/core';
import { forbidden, AppError } from '../utils/errors';
import { wrap } from '../utils/http';
import { demoWriteLimiter } from './rateLimit';

const allowedWrite = (method: string, path: string) =>
  (method === 'POST' && [
    '/auth/login', '/auth/refresh', '/auth/logout', '/sales/calculate',
    '/sales', '/sales/held',
  ].includes(path)) ||
  (method === 'DELETE' && /^\/sales\/held\/[a-f\d]{24}$/i.test(path)) ||
  (method === 'POST' && /^\/cash-registers\/[a-f\d]{24}\/open-shift$/i.test(path)) ||
  (method === 'POST' && /^\/cash-registers\/shifts\/[a-f\d]{24}\/close$/i.test(path));

/** Reject all other demo writes even if a route later gains broader permissions. */
export const demoWritePolicy: RequestHandler = (req, res, next) => {
  if (!env.demoMode || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!allowedWrite(req.method, req.path)) return next(forbidden('This action is unavailable in Demo Mode'));
  demoWriteLimiter(req, res, next);
};

/** Distributed admission count: a reset can start only after every request has completed. */
export const demoRequestGate = wrap(async (_req, res, next) => {
  if (!env.demoMode) return next();
  const admitted = await DemoControl.findOneAndUpdate(
    { _id: 'public-demo', resetting: false },
    { $inc: { activeRequests: 1 } },
    { new: true },
  );
  if (!admitted) throw new AppError(503, 'DEMO_RESETTING', 'Demo data is being refreshed. Please try again shortly.');
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    void DemoControl.updateOne({ _id: 'public-demo' }, { $inc: { activeRequests: -1 } });
  };
  res.once('finish', release);
  res.once('close', release);
  next();
});
