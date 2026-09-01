import { loadConfig } from './config/env.js';
import { BrowserManager } from './automation/browser.js';
import { logger } from './logger.js';
import { PagePool } from './page-pool.js';
import { createApp } from './server.js';

async function main() {
  const config = loadConfig();
  const browser = new BrowserManager(config);
  const pool = new PagePool(config, browser);
  await pool.start();

  const app = createApp(config, pool);
  const server = app.listen(config.port, config.host, () => {
    logger.info(
      {
        host: config.host,
        port: config.port,
        maxPages: config.maxPages,
        browserMode: config.browserMode,
        cdp: config.isAttach,
        cdpAttachTab: config.cdpAttachTab,
        headless: config.headless,
      },
      'API listening',
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close();
    await pool.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
