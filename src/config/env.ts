import { z } from 'zod';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { logger } from '../logger.js';
import { isCdpEndpoint } from './cdp-channels.js';

export { CDP_CHANNELS, isCdpChannel, isCdpEndpoint } from './cdp-channels.js';
export type { CdpChannel } from './cdp-channels.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const localEnvPath = path.join(projectRoot, '.env');

/**
 * Load secrets/config from the operator's local `.env` only.
 * Never reads `.env.example`. Does not override vars already set in the shell.
 * Missing `.env` is OK in CI/tests (process env / loadConfig args supply values).
 */
function loadLocalEnv(): void {
  if (!existsSync(localEnvPath)) {
    const allowMissing =
      process.env.CI === 'true' ||
      process.env.VITEST === 'true' ||
      process.env.SKIP_DOTENV === '1';
    if (allowMissing) {
      return;
    }
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

const emptyToUndef = z
  .string()
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const t = v.trim();
    return t === '' ? undefined : t;
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
    CHATBOT_URL: emptyToUndef,
    MOCK_PORT: z.coerce.number().int().positive().default(4173),
    HEADLESS: boolFromEnv,
    USER_DATA_DIR: z.string().default('./data/browser-profile'),
    STORAGE_STATE_PATH: z.string().default('./data/storage-state.json'),
    FIRST_TOKEN_TIMEOUT_MS: z.coerce.number().int().min(0).default(8000),
    GENERATION_TIMEOUT_MS: z.coerce.number().int().min(0).default(12000),
    SUBMIT_ACK_MS: z.coerce.number().int().positive().default(5000),
    NAVIGATION_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    SUBMIT_STRATEGY: z.enum(['click', 'auto']).default('auto'),
    LOG_PROMPTS: boolFromEnv,
    ARTIFACTS_ON_ERROR: boolFromEnv,
    BROWSER_CHANNEL: z.string().optional(),
    BROWSER_MODE: z.enum(['attach', 'launch']).optional(),
    /** http(s)/ws(s) CDP URL or a channel name (chrome, msedge, …) */
    CDP_URL: emptyToUndef,
    CDP_ATTACH_TAB: z.enum(['focused', 'url']).optional(),
    CDP_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
    /** Keep using the already-bound page; does not scan other tabs. */
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

    const browserMode = data.BROWSER_MODE ?? 'launch';
    const cdpUrl = data.CDP_URL;
    const attachTab = data.CDP_ATTACH_TAB ?? 'focused';
    const isAttach = browserMode === 'attach' || Boolean(cdpUrl);

    if (cdpUrl && !isCdpEndpoint(cdpUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'CDP_URL must be an http(s)/ws(s) URL or a browser channel (chrome, chrome-beta, chrome-dev, chrome-canary, msedge, msedge-beta, msedge-dev, msedge-canary)',
        path: ['CDP_URL'],
      });
    }

    if (browserMode === 'attach' && !cdpUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CDP_URL is required when BROWSER_MODE=attach',
        path: ['CDP_URL'],
      });
    }

    if (attachTab === 'url' && !data.CHATBOT_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CHATBOT_URL is required when CDP_ATTACH_TAB=url',
        path: ['CHATBOT_URL'],
      });
    }

    if (!isAttach && !data.CHATBOT_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CHATBOT_URL is required when BROWSER_MODE=launch',
        path: ['CHATBOT_URL'],
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

    const browserMode = data.BROWSER_MODE ?? 'launch';
    const cdpUrl = data.CDP_URL;
    const isAttach = browserMode === 'attach' || Boolean(cdpUrl);

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
      browserMode,
      isAttach,
      cdpUrl,
      cdpAttachTab: data.CDP_ATTACH_TAB ?? 'focused',
      cdpConnectTimeoutMs: data.CDP_CONNECT_TIMEOUT_MS,
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
