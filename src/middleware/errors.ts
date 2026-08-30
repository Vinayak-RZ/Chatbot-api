import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { AppConfig } from '../config/env.js';
import { AppError, isAppError } from '../errors.js';

export function createRateLimiter(config: AppConfig) {
  return rateLimit({
    windowMs: 60_000,
    max: config.rateLimitRpm,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    keyGenerator: (req) => req.header('x-api-key') || req.ip || 'anon',
    handler: (_req, _res, next) => {
      next(
        new AppError('RATE_LIMITED', 'Rate limit exceeded', 429, {
          retryAfterSeconds: 60,
        }),
      );
    },
    skip: (req) => req.path === '/health',
  });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (isAppError(err)) {
    if (err.code === 'RATE_LIMITED') {
      res.setHeader('Retry-After', '60');
    }
    res.status(err.status).json({
      ok: false,
      code: err.code,
      error: err.message,
      partial: err.code === 'TIMEOUT' ? true : undefined,
      response: err.details?.response,
      requestId: _req.requestId,
      ...err.details,
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Internal error';
  res.status(500).json({
    ok: false,
    code: 'INTERNAL_ERROR',
    error: message,
    requestId: _req.requestId,
  });
}
