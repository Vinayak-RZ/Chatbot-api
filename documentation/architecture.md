# Architecture — Chatbot-to-API Bridge

Intended-state map for reviewers. Implementation lives under `src/` on `feat/v1-bridge`.

## Product overview

A localhost REST service drives a ChatGPT-like web UI with a **per-API-key page pool** (`MAX_PAGES` 1–3). Operator default is **attach** to a pre-opened Chrome/Edge (`BROWSER_MODE=attach`, one designated tab, no inspection of other tabs). Tests/CI **launch** a throwaway persistent Chromium against the local dark mock ([`scripts/mock-chatbot/`](../scripts/mock-chatbot/)). See [`docs/CUTOVER.md`](../docs/CUTOVER.md).

## Stack (locked)

| Layer | Choice |
|-------|--------|
| Runtime | Node 20+, TypeScript |
| HTTP | Express, `127.0.0.1:8787` |
| Browser | Playwright attach (`connectOverCDP`) or `launchPersistentContext` |
| Queue | `p-queue` concurrency 1 **per page/key** |
| Rate limit | `express-rate-limit` 10 rpm/key (cap 20) |
| Validation | zod (env + bodies) |
| Logs | pino, prompts redacted by default |

## Components

```text
[API client]
    |  x-api-key
    v
[Express] --> rate limit --> validate --> [page pool]
                                              |
                         +--------------------+--------------------+
                         v                    v                    v
                   [queue+page A]       [queue+page B]       [queue+page C]
                         |                    |                    |
                         +--------------------+--------------------+
                                              v
                                    [chat automation]
                                              v
                         [attached Chrome tab | persistent context]
                                              v
                              [Mock ChatGPT UI | owned clone]
```

Key modules: `src/server.ts`, `src/page-pool.ts`, `src/automation/browser.ts`, `src/automation/chat.ts`, `src/config/env.ts`, `src/config/selectors.ts`.

## Trust boundaries

- Bind loopback only.
- Allowlist API keys (1–3); timing-safe compare.
- Isolation is **thread-level** (separate pages + New chat), not separate accounts (cookies shared in one profile).
- Attach mode binds **one designated tab** (focused, or opted-in `CHATBOT_URL`). Other tabs are not logged or scanned.
- Never default `CHATBOT_URL` to chatgpt.com.
