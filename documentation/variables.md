# Variables & secrets — Chatbot-to-API Bridge

All server-side. Nothing is bundled into a public client.

| Name | Used by | Scope | Source | Rotation | Risk |
|------|---------|-------|--------|----------|------|
| `API_KEY` | Express auth (single key) | server | `.env` | regenerate | **High** |
| `API_KEYS` | Express allowlist (1–3, wins over `API_KEY`) | server | `.env` | regenerate | **High** |
| `MAX_PAGES` | Page pool (1–3, default 1) | server | `.env` | n/a | Med — more pages = more CPU |
| `RATE_LIMIT_RPM` | express-rate-limit (default 10, cap 20) | server | `.env` | n/a | Low |
| `STORAGE_STATE_PATH` | Playwright | disk | owner JSON | re-export | **High** |
| `USER_DATA_DIR` | Playwright profile (launch mode) | disk | local path | delete = new profile | **High** |
| `CHATBOT_URL` | browser | server | `.env` | n/a | Med — required for launch; optional in focused attach |
| `BROWSER_MODE` | `attach` \| `launch` (default `launch`) | server | `.env` | n/a | Med |
| `CDP_URL` | Playwright attach (URL or `chrome` / `msedge`) | server | `.env` | n/a | Med — required for attach |
| `CDP_ATTACH_TAB` | `focused` \| `url` (default `focused`) | server | `.env` | n/a | Med — which tab to bind |
| `CDP_CONNECT_TIMEOUT_MS` | CDP attach (default 90000) | server | `.env` | n/a | Low |
| `CDP_REUSE_TABS` | keep the bound page (default true; does not scan other tabs) | server | `.env` | n/a | Low |
| `HEADLESS` | Playwright launch | server | `.env` | n/a | Low |
| `HOST` / `PORT` | Express | server | `.env` | n/a | Med if `0.0.0.0` |
| `QUEUE_MAX` | per-page queue | server | `.env` | n/a | Low |
| `MAX_PROMPT_CHARS` | validation | server | `.env` | n/a | Low |
| `FIRST_TOKEN_TIMEOUT_MS` | wait | server | `.env` | n/a | Low |
| `GENERATION_TIMEOUT_MS` | wait | server | `.env` | n/a | Low |
| `SUBMIT_ACK_MS` | wait for send after insert | server | `.env` | n/a | Low |
| `SUBMIT_STRATEGY` | `click` \| `auto` | server | `.env` | n/a | Low |
| `NAVIGATION_TIMEOUT_MS` | Playwright | server | `.env` | n/a | Low |
| `BROWSER_CHANNEL` | Playwright launch | server | `.env` | n/a | Low |
| `LOG_PROMPTS` | pino | server | `.env` | n/a | **High** if true |
| `ARTIFACTS_ON_ERROR` | automation (bound page only) | disk | `.env` | n/a | Med |
| `MOCK_PORT` | mock server | server | `.env` | n/a | Low |

## Defaults (intended)

- `HOST=127.0.0.1`, `PORT=8787`
- `MAX_PAGES=1`
- `RATE_LIMIT_RPM=10`
- `BROWSER_MODE=launch` (tests/CI). Operator attach: `attach` + `CDP_URL=chrome`
- `CDP_ATTACH_TAB=focused`
- `HEADLESS=false` by default (visible Chromium window in launch mode); set `true` for CI/servers
- `GENERATION_TIMEOUT_MS=12000`
- `FIRST_TOKEN_TIMEOUT_MS=8000`
- `LOG_PROMPTS=false`
- `CHATBOT_URL=http://127.0.0.1:4173` (mock) for launch mode

## Boot validation

- `API_KEYS` length must be `1..MAX_PAGES` (and ≤ 3)
- `MAX_PAGES` ∈ {1,2,3}
- `BROWSER_MODE=attach` requires `CDP_URL` (http(s)/ws(s) or a channel name)
- `CDP_ATTACH_TAB=url` requires `CHATBOT_URL`
- Launch mode (no CDP) requires `CHATBOT_URL`

## Pre-go-live

- [ ] Keys are not `change-me`
- [ ] Attach: designated tab is the owned ChatGPT-like UI; other tabs are not logged
- [ ] Session file is not committed
- [ ] `data/` and `artifacts/` gitignored
- [ ] Port not published to the internet
