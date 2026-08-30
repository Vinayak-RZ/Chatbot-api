# Decisions

Architecture decision records. Newest first in the index.

| ID | Title | Status |
|----|-------|--------|
| ADR-001 | Playwright, not Puppeteer | accepted |
| ADR-002 | Express + TypeScript | accepted |
| ADR-003 | ChatGPT-faithful mock; never live-scrape chatgpt.com | accepted |
| ADR-004 | Session injection over interactive login | accepted |
| ADR-005 | New chat is a button | accepted |
| ADR-006 | Generation budget 12s (observed 3–5s) | accepted |
| ADR-007 | Headless is env-configurable | accepted |
| ADR-008 | Timeouts return text with `partial: true` | accepted |
| ADR-009 | ProseMirror-safe insert; mock gates Send on `input` | accepted |
| ADR-010 | Nawab PID instead of Spec Kit | accepted |
| ADR-011 | Phase 0 is docs-only | accepted |
| ADR-012 | Rate limit 10 rpm per API key | accepted |
| ADR-013 | Playwright optimization playbook is normative | accepted |
| ADR-014 | One page per API key (max 3); first-use New chat | accepted |

---

## ADR-001 — Playwright

**Context:** Original spec preferred Playwright.  
**Choice:** Playwright persistent context.  
**Rejected:** Puppeteer (weaker tracing/auto-wait).  
**Consequences:** `npx playwright install` on Windows.

## ADR-002 — Express + TypeScript

**Context:** Original allowed Express or Fastify, JS or TS.  
**Choice:** Express + TS + zod + pino + p-queue.  
**Rejected:** Fastify (fine, but Express was listed first); plain JS.

## ADR-003 — ChatGPT-faithful mock, no live scrape

**Context:** Owner’s UI matches ChatGPT; URL comes later; they asked to “scrape ChatGPT HTML” for the build.  
**Choice:** Freeze a **local** DOM contract from public ChatGPT landmarks (`data-message-author-role`, `#prompt-textarea`, send/stop testids). Implement that in the mock. Do **not** open chatgpt.com in Playwright.  
**Rejected:** Generic fake chat with different testids; automating OpenAI’s site.  
**Consequences:** Cutover is URL + session + selector verify. Legal/ToS risk of driving chatgpt.com is avoided.

## ADR-004 — Session file

**Context:** Owned bot has login; owner will provide a session.  
**Choice:** Playwright `storageState` at launch. API process must not wait for a human to type passwords. Mock may include `/auth/login` so tests mint a state file.  
**Rejected:** 5-minute headed login loop inside the server as the production path.

## ADR-005 — New chat button

**Context:** Owner: New chat is a button/control, not a URL. Dump uses an `<a>`.  
**Choice:** Canonical `a[data-testid="create-new-chat-button"]` (fallback accessible name `/new chat/i`). No `NEW_CHAT_URL` as primary.

## ADR-006 — Short generation timeout

**Context:** Owner sees 3–5s generations.  
**Choice:** `FIRST_TOKEN_TIMEOUT_MS=8000`, `GENERATION_TIMEOUT_MS=12000`. Mock default stream 3000ms; tests also use 5000ms.  
**Rejected:** 60s default (hides hangs, stalls the queue).

## ADR-007 — Headless both

**Context:** Owner wants visible and headless.  
**Choice:** `HEADLESS=true|false`. Default false while building.

## ADR-008 — Partial replies

**Context:** Owner: partial is OK if flagged.  
**Choice:** HTTP 504, `code: TIMEOUT`, `partial: true`, `response` = scraped text. Success 200 always has `partial: false`.  
**Rejected:** Dropping text on timeout; 200 with a quiet truncation.

## ADR-009 — Composer insert

**Context:** ChatGPT-like composers use contenteditable/ProseMirror; setting innerHTML often sends empty.  
**Choice:** Automation uses fill / `execCommand('insertText')` / paste. Mock enables Send only after `input`.  
**Sources:** public notes on `#prompt-textarea.ProseMirror` and insertText/paste.

## ADR-010 — Nawab over Spec Kit

**Context:** User asked for spec-driven then explicitly **nawab-plans** for the PID.  
**Choice:** 18-section `IMPLEMENTATION_PLAN.md`. No `.specify/` directory.

## ADR-011 — Docs-only until Phase A approval

**Context:** User: this work is product documentation only.  
**Choice:** Phase 0 commit contains no `src/`. Implementation starts when they approve Phase A.  
**Superseded for execution:** Phase A+ approved; code lands on `feat/v1-bridge`.

## ADR-012 — Rate limit 10 rpm per API key

**Context:** Owner wants ~10–20 requests/minute protection against spam.  
**Choice:** `express-rate-limit`, window 60s, default `RATE_LIMIT_RPM=10`, cap 20, keyed by `x-api-key`. Distinct from `QUEUE_FULL`.  
**Rejected:** Global process-wide RPM only; relying solely on the queue.

## ADR-013 — Playwright playbook is normative

**Context:** Flaky waits and naive innerHTML inserts are the main failure modes.  
**Choice:** Hybrid wait, ProseMirror insert path, no `networkidle`, traces on failure only — documented in IMPLEMENTATION_PLAN §8.  
**Rejected:** Treating wait strategy as optional polish.

## ADR-014 — One page per API key (max 3)

**Context:** Multiple API keys must not share conversation context; default should stay light.  
**Choice:** `MAX_PAGES` 1–3 (default 1); allowlist 1–3 keys; `Map<apiKey, {page, queue}>`; first use of a key always clicks New chat; same key continues on `/chat/send`; `/chat/new` scoped to that key’s page.  
**Rejected:** One shared page for all keys; opening a new page per HTTP request; more than 3 pages.
