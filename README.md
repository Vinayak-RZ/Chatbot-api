# Chatbot-api

Turns an owned ChatGPT-like web chatbot into a REST API by driving a real browser (Playwright).

**Status:** Phase A+ on `feat/v1-bridge` — per-API-key page pool (default 1, max 3), 10 rpm rate limit, ChatGPT-shell mock.

## Quick start

```powershell
copy .env.example .env
npm install
npx playwright install chromium

# terminal 1
npm run mock

# terminal 2
npm run dev
```

```powershell
curl http://127.0.0.1:8787/health
curl -X POST http://127.0.0.1:8787/chat/send -H "content-type: application/json" -H "x-api-key: dev-key-change-me" -d "{\"prompt\":\"hello\"}"
curl -X POST http://127.0.0.1:8787/chat/new -H "x-api-key: dev-key-change-me"
```

## Multi-key / multi-page

| Env | Meaning |
|-----|---------|
| `MAX_PAGES` | 1–3 simultaneous Playwright pages (default **1**) |
| `API_KEY` | Single key |
| `API_KEYS` | Comma-separated allowlist (1–3). Wins over `API_KEY`. Must be ≤ `MAX_PAGES` |
| `RATE_LIMIT_RPM` | Default **10**, cap 20, per key |

Each API key gets its **own page and queue**. The first request for a key always starts a **new chat**. Later `/chat/send` calls on the same key **continue** that thread. `/chat/new` only affects that key’s page.

Example (two parallel chats):

```env
MAX_PAGES=2
API_KEYS=key-a,key-b
```

## Docs

| Doc | Role |
|-----|------|
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Execution contract |
| [docs/PRD-chatbot-api.md](docs/PRD-chatbot-api.md) | Product requirements |
| [docs/specs/02-chatgpt-dom-contract.md](docs/specs/02-chatgpt-dom-contract.md) | DOM / selectors |
| [PROGRESS.md](PROGRESS.md) | Live status |
| [DECISIONS.md](DECISIONS.md) | ADRs |

## Validate (Windows)

```powershell
.\scripts\validate.ps1
```

## Cutover

Set `CHATBOT_URL` to your owned clone (not chatgpt.com) and provide `STORAGE_STATE_PATH`. Do not commit session files.
