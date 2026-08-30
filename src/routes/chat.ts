import { Router } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { AppError } from '../errors.js';
import type { PagePool } from '../page-pool.js';

export function createChatRouter(config: AppConfig, pool: PagePool): Router {
  const router = Router();

  const sendSchema = z.object({
    prompt: z.string().min(1).max(config.maxPromptChars),
    sessionId: z.string().optional(),
  });

  router.post('/send', async (req, res, next) => {
    const started = Date.now();
    try {
      const body = sendSchema.safeParse(req.body);
      if (!body.success) {
        throw new AppError('VALIDATION_ERROR', 'Invalid request body', 400, {
          issues: body.error.issues,
        });
      }
      const apiKey = req.apiKey!;
      const requestId = req.requestId!;
      const result = await pool.send(apiKey, body.data.prompt, requestId);

      if (result.partial) {
        res.status(504).json({
          ok: false,
          code: 'TIMEOUT',
          partial: true,
          response: result.response,
          sessionId: body.data.sessionId ?? null,
          durationMs: result.durationMs,
          requestId,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        partial: false,
        response: result.response,
        sessionId: body.data.sessionId ?? null,
        durationMs: result.durationMs,
        requestId,
      });
    } catch (err) {
      if (err instanceof AppError && err.code === 'TIMEOUT') {
        // already handled
      }
      // Attach wall time for debugging
      if (err instanceof AppError) {
        err.details = { ...err.details, durationMs: Date.now() - started };
      }
      next(err);
    }
  });

  router.post('/new', async (req, res, next) => {
    try {
      const apiKey = req.apiKey!;
      const requestId = req.requestId!;
      await pool.newChat(apiKey, requestId);
      res.status(200).json({
        ok: true,
        requestId,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
