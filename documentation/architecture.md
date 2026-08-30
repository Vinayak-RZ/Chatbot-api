# Architecture — Chatbot-to-API Bridge

Intended-state map for reviewers and the next coding agent. No application code exists yet; this describes v1 as specified.

## Product overview

A localhost REST service drives one Playwright browser against a ChatGPT-like web UI. Default UI is a local mock that implements [`docs/specs/02-chatgpt-dom-contract.md`](../docs/specs/02-chatgpt-dom-contract.md). Cutover points `CHATBOT_URL` at an owned clone and loads an owner-supplied `storageState`.

**Assumptions:** mock DOM ≈ owned clone; session file skips interactive login; 3–5s generation fits a 12s budget. See [`docs/ASSUMPTIONS.md`](../docs/ASSUMPTIONS.md).

## Stack (locked)

| Layer | Choice |
|-------|--------|
| Runtime | Node 20+, TypeScript |
| HTTP | Express, `127.0.0.1:8787` |
| Browser | Playwright persistent Chromium/Chrome |
| Queue | `p-queue` concurrency 1 |
| Validation | zod (env + bodies) |
| Logs | pino, prompts redacted by default |

## Components

```text
[API client]
    |  x-api-key
    v
[Express] --validate--> [p-queue, max N, concurrency 1]
                            |
                            v
                    [chat automation]
                            |
                            v
                    [Playwright page]
                            |
                            v
              [Mock ChatGPT UI | owned clone]
```

- **server** — three routes, API key, JSON errors.
- **queue** — one in-flight generation; reject at cap.
- **browser** — launch, crash relaunch, storageState, HEADLESS.
- **chat** — new-chat button, composer insert, wait-for-done, scrape assistant body.
- **mock** — ChatGPT landmarks, 3s stream, optional login page.

No database. No scheduled jobs. No email. No public SEO surface. No embedded LLM SDK — the “model” is the UI being driven.

## Auth / session flow

1. **API callers** prove knowledge of `API_KEY` via `x-api-key` (POST only). Health is open.
2. **Target chatbot session** is not interactive in the API process. Playwright loads `STORAGE_STATE_PATH` if present. Chat-ready = `#prompt-textarea` visible.
3. There is no user table, JWT, or tenancy.

## Trust boundaries

| Boundary | What crosses | Control |
|----------|----------------|---------|
| Client → Express | Prompt text, API key | Key check, max prompt length, localhost bind |
| Express → Playwright | Same prompt, into the DOM | Queue, timeouts, selector isolation |
| Playwright → Chat UI | Keystrokes, clicks | Owner-owned URL only; no chatgpt.com |
| Process → disk | Traces, screenshots, browser profile | gitignored `artifacts/`, `data/` |

## Known risks

| Risk | Where it will show up |
|------|------------------------|
| Owned DOM ≠ mock contract | `selectors.ts` vs cutover discover dump |
| Session expired | Health `loggedIn: false` |
| Contenteditable insert sends empty | Mock enables Send only on `input` |
| Timeout wedged Stop | `recover.ts` clicks stop-button |
| Prompt leakage | `LOG_PROMPTS=false` |

## Related documents

- [`flows.md`](./flows.md)
- [`permissions.md`](./permissions.md)
- [`variables.md`](./variables.md)
- [`tests.md`](./tests.md)
- [`automation.md`](./automation.md)
- No `emails.md` — this app does not send email.
- No `cron.md` — no scheduled work (in-process FIFO only).
- No `seo.md` — API is localhost, not indexable.
