import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  if (err instanceof AppError) {
    return res
      .status(err.status)
      .json({ success: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof RangeError) {
    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: err.message } });
  }
  if ((err as { code?: number })?.code === 11000) {
    const key = Object.keys((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {})[0] ?? 'value';
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE',
        message: `A record with this ${key} already exists`,
        details: { field: key },
      },
    });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
      },
    });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res
      .status(400)
      .json({ success: false, error: { code: 'BAD_REQUEST', message: `Invalid ${err.path}` } });
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return res
      .status(400)
      .json({ success: false, error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
  }
  logger.error({ err, path: req.path, method: req.method }, 'unhandled error');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong',
      ...(env.isProd ? {} : { details: (err as Error)?.message }),
    },
  });
}
