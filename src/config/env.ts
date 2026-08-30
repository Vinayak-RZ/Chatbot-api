import { z } from 'zod';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { logger } from '../logger.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localEnvPath = path.join(projectRoot, '.env');

/**
 * Load secrets/config from the operator's local `.env` only.
 * Never reads `.env.example`. Does not override vars already set in the shell.
 */
function loadLocalEnv(): void {
  if (!existsSync(localEnvPath)) {
    throw new Error(
      `Missing local .env at ${localEnvPath}. Copy .env.example to .env and edit values yourself — this app will not use .env.example.`,
    );
  }
  const result = loadDotenv({ path: localEnvPath, override: false, quiet: true });
  if (result.error) {
    throw new Error(`Failed to load local .env: ${result.error.message}`);
  }
  const keyCount = result.parsed ? Object.keys(result.parsed).length : 0;
  logger.info({ path: '.env', keys: keyCount }, 'Loaded local env file');
}

loadLocalEnv();

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined || v === '') return undefined;
    return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
  });

const envSchema = z
  .object({
    HOST: z
      .string()
      .default('127.0.0.1')
      .refine(
        (h) => h === '127.0.0.1' || h === 'localhost' || h === '::1',
        'HOST must be loopback (127.0.0.1, localhost, or ::1)',
      ),
    PORT: z.coerce.number().int().positive().default(8787),
    API_KEY: z.string().optional(),
    API_KEYS: z.string().optional(),
    MAX_PAGES: z.coerce.number().int().min(1).max(3).default(1),
    RATE_LIMIT_RPM: z.coerce.number().int().min(1).max(20).default(10),
    QUEUE_MAX: z.coerce.number().int().min(1).max(100).default(8),
    MAX_PROMPT_CHARS: z.coerce.number().int().min(1).default(8000),
    // Operator-supplied target; no format or host checks at boot.
    CHATBOT_URL: z.string().min(1),
    MOCK_PORT: z.coerce.number().int().positive().default(4173),
    HEADLESS: boolFromEnv,
    USER_DATA_DIR: z.string().default('./data/browser-profile'),
    STORAGE_STATE_PATH: z.string().default('./data/storage-state.json'),
    FIRST_TOKEN_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    GENERATION_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
    SUBMIT_ACK_MS: z.coerce.number().int().positive().default(5000),
    NAVIGATION_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    SUBMIT_STRATEGY: z.enum(['click', 'auto']).default('auto'),
    LOG_PROMPTS: boolFromEnv,
    ARTIFACTS_ON_ERROR: boolFromEnv,
    BROWSER_CHANNEL: z.string().optional(),
    /** Attach to an existing Chrome/Edge via CDP, e.g. http://127.0.0.1:9222 */
    CDP_URL: z.string().url().optional(),
    /** When using CDP, reuse an open tab on the Chatbot URL instead of always opening a new one */
    CDP_REUSE_TABS: boolFromEnv,
  })
  .superRefine((data, ctx) => {
    const fromList = data.API_KEYS
      ? data.API_KEYS.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const keys =
      fromList.length > 0
        ? fromList
        : data.API_KEY
          ? [data.API_KEY]
          : [];

    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'API_KEY or API_KEYS (1–3) is required',
        path: ['API_KEYS'],
      });
      return;
    }
    if (keys.length > 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At most 3 API keys are allowed',
        path: ['API_KEYS'],
      });
    }
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'API keys must be unique',
        path: ['API_KEYS'],
      });
    }
    if (keys.length > data.MAX_PAGES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `API_KEYS length (${keys.length}) must be <= MAX_PAGES (${data.MAX_PAGES})`,
        path: ['MAX_PAGES'],
      });
    }
  })
  .transform((data) => {
    const fromList = data.API_KEYS
      ? data.API_KEYS.split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const apiKeys =
      fromList.length > 0
        ? fromList
        : data.API_KEY
          ? [data.API_KEY]
          : [];

    return {
      host: data.HOST,
      port: data.PORT,
      apiKeys,
      maxPages: data.MAX_PAGES,
      rateLimitRpm: data.RATE_LIMIT_RPM,
      queueMax: data.QUEUE_MAX,
      maxPromptChars: data.MAX_PROMPT_CHARS,
      chatbotUrl: data.CHATBOT_URL,
      mockPort: data.MOCK_PORT,
      headless: data.HEADLESS ?? false,
      userDataDir: path.resolve(data.USER_DATA_DIR),
      storageStatePath: path.resolve(data.STORAGE_STATE_PATH),
      firstTokenTimeoutMs: data.FIRST_TOKEN_TIMEOUT_MS,
      generationTimeoutMs: data.GENERATION_TIMEOUT_MS,
      submitAckMs: data.SUBMIT_ACK_MS,
      navigationTimeoutMs: data.NAVIGATION_TIMEOUT_MS,
      submitStrategy: data.SUBMIT_STRATEGY,
      logPrompts: data.LOG_PROMPTS ?? false,
      artifactsOnError: data.ARTIFACTS_ON_ERROR ?? true,
      browserChannel: data.BROWSER_CHANNEL,
      cdpUrl: data.CDP_URL,
      cdpReuseTabs: data.CDP_REUSE_TABS ?? true,
    };
  });

export type AppConfig = z.output<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  return parsed.data;
}

export function storageStateExists(config: AppConfig): boolean {
  return existsSync(config.storageStatePath);
}
