# Variables & secrets — Chatbot-to-API Bridge

All server-side. Nothing is bundled into a public client (there is no customer SPA).

| Name | Used by | Scope | Source | Rotation | Risk |
|------|---------|-------|--------|----------|------|
| `API_KEY` | Express auth | server | `.env` | operator regenerates; clients update header | **High** — spam the owned bot if leaked |
| `STORAGE_STATE_PATH` file | Playwright | server / disk | owner-supplied JSON | re-export when chatbot session dies | **High** — full chatbot login |
| `USER_DATA_DIR` | Playwright profile | disk | local path | delete folder = new profile | **High** — cookies |
| `CHATBOT_URL` | browser | server | `.env` | n/a | Med — wrong host = driving the wrong site |
| `HEADLESS` | Playwright | server | `.env` | n/a | Low |
| `HOST` / `PORT` | Express | server | `.env` | n/a | Med if bound to `0.0.0.0` |
| `QUEUE_MAX` | queue | server | `.env` | n/a | Low |
| `MAX_PROMPT_CHARS` | validation | server | `.env` | n/a | Low |
| `FIRST_TOKEN_TIMEOUT_MS` | wait | server | `.env` | n/a | Low |
| `GENERATION_TIMEOUT_MS` | wait | server | `.env` | n/a | Low — too high stalls the queue |
| `BROWSER_CHANNEL` | Playwright | server | `.env` | n/a | Low |
| `LOG_PROMPTS` | pino | server | `.env` | n/a | **High** if true |
| `ARTIFACTS_ON_ERROR` | automation | disk | `.env` | n/a | Med — screenshots may show prompts |

## Defaults (intended)

- `HOST=127.0.0.1`
- `HEADLESS=false` during build; operator may set `true`
- `GENERATION_TIMEOUT_MS=12000` (3–5s observed + slack)
- `LOG_PROMPTS=false`

## Pre-go-live

- [ ] `API_KEY` is not `change-me`
- [ ] `CHATBOT_URL` is the owned clone, not chatgpt.com
- [ ] Session file is not committed
- [ ] `data/` and `artifacts/` gitignored
- [ ] Port not published to the internet
