import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AppConfig } from '../config/env.js';
import { AppError } from '../errors.js';

declare global {
  namespace Express {
    interface Request {
      apiKey?: string;
      requestId?: string;
    }
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function apiKeyMiddleware(config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header('x-api-key') ?? '';
    const match = config.apiKeys.find((k) => safeEqual(header, k));
    if (!match) {
      next(new AppError('UNAUTHORIZED', 'Missing or invalid API key', 401));
      return;
    }
    req.apiKey = match;
    next();
  };
}
