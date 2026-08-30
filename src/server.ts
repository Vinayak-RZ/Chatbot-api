import express from 'express';
import type { AppConfig } from './config/env.js';
import { apiKeyMiddleware } from './middleware/auth.js';
import { createRateLimiter, errorHandler } from './middleware/errors.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import type { PagePool } from './page-pool.js';
import { createChatRouter } from './routes/chat.js';

export function createApp(config: AppConfig, pool: PagePool) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware);

  app.get('/health', (_req, res) => {
    const h = pool.getHealth();
    res.status(200).json({
      ok: true,
      status: 'up',
      pagesBound: h.pagesBound,
      maxPages: h.maxPages,
      cdp: Boolean(config.cdpUrl),
      chatbotUrl: config.chatbotUrl,
    });
  });

  const chat = express.Router();
  chat.use(apiKeyMiddleware(config));
  chat.use(createRateLimiter(config));
  chat.use(createChatRouter(config, pool));
  app.use('/chat', chat);

  app.use(errorHandler);
  return app;
}
