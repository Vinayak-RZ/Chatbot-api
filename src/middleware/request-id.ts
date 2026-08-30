import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const raw = req.header('x-request-id') || randomUUID();
  // Prevent path traversal if requestId is used under artifacts/
  const id = raw.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 80) || randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
