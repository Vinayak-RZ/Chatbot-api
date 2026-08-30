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

**Context:** Owner: New chat is a button.  
**Choice:** `button[data-testid="new-chat-button"]`. No `NEW_CHAT_URL` as primary.

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
