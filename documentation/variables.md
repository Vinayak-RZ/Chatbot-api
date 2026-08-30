# Variables & secrets — Chatbot-to-API Bridge

All server-side. Nothing is bundled into a public client.

| Name | Used by | Scope | Source | Rotation | Risk |
|------|---------|-------|--------|----------|------|
| `API_KEY` | Express auth (single key) | server | `.env` | regenerate | **High** |
| `API_KEYS` | Express allowlist (1–3, wins over `API_KEY`) | server | `.env` | regenerate | **High** |
| `MAX_PAGES` | Page pool (1–3, default 1) | server | `.env` | n/a | Med — more pages = more CPU |
| `RATE_LIMIT_RPM` | express-rate-limit (default 10, cap 20) | server | `.env` | n/a | Low |
| `STORAGE_STATE_PATH` | Playwright | disk | owner JSON | re-export | **High** |
| `USER_DATA_DIR` | Playwright profile | disk | local path | delete = new profile | **High** |
| `CHATBOT_URL` | browser | server | `.env` | n/a | Med — not chatgpt.com |
| `CDP_URL` | Playwright attach | server | `.env` | n/a | Med — attach to debug Chrome |
| `CDP_REUSE_TABS` | page pool | server | `.env` | n/a | Low — default true |
| `HEADLESS` | Playwright | server | `.env` | n/a | Low |
| `HOST` / `PORT` | Express | server | `.env` | n/a | Med if `0.0.0.0` |
| `QUEUE_MAX` | per-page queue | server | `.env` | n/a | Low |
| `MAX_PROMPT_CHARS` | validation | server | `.env` | n/a | Low |
| `FIRST_TOKEN_TIMEOUT_MS` | wait | server | `.env` | n/a | Low |
| `GENERATION_TIMEOUT_MS` | wait | server | `.env` | n/a | Low |
| `SUBMIT_ACK_MS` | wait for send after insert | server | `.env` | n/a | Low |
| `SUBMIT_STRATEGY` | `click` \| `auto` | server | `.env` | n/a | Low |
| `NAVIGATION_TIMEOUT_MS` | Playwright | server | `.env` | n/a | Low |
| `BROWSER_CHANNEL` | Playwright | server | `.env` | n/a | Low |
| `LOG_PROMPTS` | pino | server | `.env` | n/a | **High** if true |
| `ARTIFACTS_ON_ERROR` | automation | disk | `.env` | n/a | Med |
| `MOCK_PORT` | mock server | server | `.env` | n/a | Low |

## Defaults (intended)

- `HOST=127.0.0.1`, `PORT=8787`
- `MAX_PAGES=1`
- `RATE_LIMIT_RPM=10`
- `HEADLESS=false` by default (visible Chromium window); set `true` for CI/servers
- Optional `CDP_URL=http://127.0.0.1:9222` to attach to Chrome from `scripts/chrome-debug.ps1`
- `GENERATION_TIMEOUT_MS=12000`
- `FIRST_TOKEN_TIMEOUT_MS=8000`
- `LOG_PROMPTS=false`
- `CHATBOT_URL=http://127.0.0.1:4173` (mock)

## Boot validation

- `API_KEYS` length must be `1..MAX_PAGES` (and ≤ 3)
- `MAX_PAGES` ∈ {1,2,3}
- `CHATBOT_URL` hostname must not be `chatgpt.com`

## Pre-go-live

- [ ] Keys are not `change-me`
- [ ] `CHATBOT_URL` is the owned clone, not chatgpt.com
- [ ] Session file is not committed
- [ ] `data/` and `artifacts/` gitignored
- [ ] Port not published to the internet
