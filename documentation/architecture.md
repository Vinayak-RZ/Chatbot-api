# Architecture — Chatbot-to-API Bridge

Intended-state map for reviewers. Implementation lives under `src/` on `feat/v1-bridge`.

## Product overview

A localhost REST service drives one Playwright **persistent context** with a **per-API-key page pool** (`MAX_PAGES` 1–3) against a ChatGPT-like web UI. Default UI is the local dark mock ([`scripts/mock-chatbot/`](../scripts/mock-chatbot/)). Cutover points `CHATBOT_URL` at an owned clone and loads owner-supplied `storageState`. See [`docs/CUTOVER.md`](../docs/CUTOVER.md).

## Stack (locked)

| Layer | Choice |
|-------|--------|
| Runtime | Node 20+, TypeScript |
| HTTP | Express, `127.0.0.1:8787` |
| Browser | Playwright `launchPersistentContext` |
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
                                    [persistent context]
                                              v
                              [Mock ChatGPT UI | owned clone]
```

Key modules: `src/server.ts`, `src/page-pool.ts`, `src/automation/browser.ts`, `src/automation/chat.ts`, `src/config/env.ts`, `src/config/selectors.ts`.

## Trust boundaries

- Bind loopback only.
- Allowlist API keys (1–3); timing-safe compare.
- Isolation is **thread-level** (separate pages + New chat), not separate accounts (cookies shared in one profile).
- Never default `CHATBOT_URL` to chatgpt.com.
