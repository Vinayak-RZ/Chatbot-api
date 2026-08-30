# PRD — Chatbot-to-API Bridge

Product requirements for wrapping an owned, ChatGPT-like chatbot UI as a small REST API by driving a real browser. This is the product document. The execution contract is [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md).

---

## 1. Summary

This product turns a ChatGPT-style web chatbot (the owner’s own UI) into `POST /chat/send` and `POST /chat/new`. A Node.js service keeps one browser open, types the prompt, waits until generation actually finishes, and returns the latest assistant message as JSON. Until the owner’s URL is plugged in, the whole stack is built and tested against a local mock whose HTML contract matches ChatGPT’s public UI landmarks.

---

## 2. Contacts

| Name | Role | Comment |
|------|------|---------|
| Vinay | Owner / operator | Owns the target chatbot URL. Provides a login session file when cutover starts. Approves Phase A implementation after this documentation set. |
| Lead coding agent | Implementer | Follows the nawab plan. Does not invent the owner’s URL or live-scrape chatgpt.com. |

---

## 3. Background

The target chatbot has no first-class model API we are allowed to call. It does have a web UI that looks and behaves like ChatGPT: sidebar, New chat button, message list, composer, send, stop-while-generating.

Browser automation is the integration surface. Playwright can keep a logged-in page alive and drive it request by request.

Why now: the owner needs a machine-callable interface in front of that UI. The owner’s real URL is not in this repo yet. Their UI is specified as ChatGPT-similar, so the build can proceed on a ChatGPT-faithful local replica, then swap `CHATBOT_URL` at cutover.

This recently became a clean split: document the ChatGPT DOM contract, implement against the mock, inject a session the owner supplies, then point at the owned clone.

---

## 4. Objective

Give any allowed client a stable HTTP way to send a prompt into the owned chatbot and get the full assistant reply, without opening the UI by hand and without calling a vendor model API.

It matters because the chatbot is already the source of answers. The missing piece is a queueable, observable, key-gated API in front of it.

### Vision

Any script that can POST a prompt should get the same answer a human would read in the ChatGPT-like window, including a clear flag when the answer was cut off.

### Key results (v1)

| KR | Target | How we know |
|----|--------|-------------|
| KR1 | Mock-backed send returns assistant text, not the user echo | E2E against local mock |
| KR2 | Generation wait uses UI/stability signals, never a fixed 3s sleep | Code review + timeout tests |
| KR3 | Typical 3s and worst 5s generations complete inside the configured budget | Mock delay + live smoke at cutover |
| KR4 | Timeout still returns scraped text with `partial: true` | Forced-delay test |
| KR5 | Headed and headless are env-switchable | `HEADLESS=true\|false` |
| KR6 | One in-flight prompt; overflow is `QUEUE_FULL` | Queue test |

---

## 5. Market segment(s)

This is not a public SaaS. The job-to-be-done is **internal automation against an owned ChatGPT-like UI**.

| Segment | Job | Constraint |
|---------|-----|------------|
| Owner / operator | Call their chatbot from scripts, other backends, or tools | They supply URL later and a session file; Windows is the first host |
| Downstream machines | POST a prompt, get text | Shared API key only; no per-user auth in v1 |

Constraints: one browser page, so one generation at a time. The owned UI may require a session cookie. We do not automate chatgpt.com itself.

---

## 6. Value proposition(s)

**Job:** turn “open the chatbot, type, wait, copy” into one HTTP call.

**Gains:** a queue, health, traces on failure, and a mock that matches the real DOM so cutover is a URL + session swap, not a rewrite.

**Pains avoided:** half-scraped streams from a fixed sleep; a wedged Stop button poisoning the next request; guessing selectors; logging in by hand on every restart if a session file is provided.

**Better than calling a vendor API:** we are wrapping the owner’s product, not paying or ToS-violating a third-party model endpoint.

---

## 7. Solution

### 7.1 UX / flows

**Operator (human)**

1. Run the local ChatGPT-like mock (build phases).
2. Or, at cutover: drop a Playwright `storageState` JSON the owner provides, set `CHATBOT_URL` to the owned clone, set `HEADLESS`.
3. Start the API process. Browser stays up for the life of the process.

**API client (machine)**

1. `POST /chat/send` with `{ "prompt": "..." }` and header `x-api-key`.
2. Wait for JSON. Read `response`. If `partial` is true, treat the text as incomplete.
3. `POST /chat/new` when a fresh thread is required (clicks the New chat **button**, then sends).
4. `GET /health` for liveness (no API key).

```text
Client --API key--> Express --FIFO queue--> Playwright page --> ChatGPT-like UI
                                                              (mock now, owned URL later)
```

### 7.2 Key features (P0)

| Feature | Behavior |
|---------|----------|
| Persistent browser | One Playwright persistent context. No per-request relaunch. |
| ChatGPT-faithful mock | Local UI using the same landmarks as ChatGPT (see DOM contract). Default `CHATBOT_URL`. |
| Session injection | Load owner-supplied `storageState`. No interactive login required for the owned bot. Mock may include a ChatGPT-like login page so this path is testable. |
| Send | Focus composer (contenteditable / `#prompt-textarea`), insert text in a ProseMirror-safe way, click Send or Enter. |
| New chat | Click the New chat **button**, then send. |
| Done-detection | Stop button gone + send re-enabled + text stable. Hard timeout. |
| Partial on timeout | HTTP 504, `code: TIMEOUT`, `partial: true`, `response` = scraped text. |
| Queue | Concurrency 1. Cap → `QUEUE_FULL`. |
| Headless switch | `HEADLESS=true\|false`. |
| Health | Browser alive, logged-in/session-ok, queue depth. |
| Recovery | Click Stop, clear composer, relaunch on crash. Artifacts on error. |
| API key | `x-api-key` on POST routes. Bind `127.0.0.1` by default. |

### 7.3 Technology

TypeScript, Node 20+, Express, Playwright, p-queue, zod, pino. Windows-first. Details in the engineering spec and DECISIONS.md.

### 7.4 Assumptions

See [`docs/ASSUMPTIONS.md`](./ASSUMPTIONS.md). Highest risk: the owned clone’s DOM drifts from the ChatGPT contract we freeze for the mock.

---

## 8. Release

Relative time, no calendar dates.

| Slice | What exists |
|-------|-------------|
| **Now (Phase 0)** | This PRD, nawab PID, DOM contract, shipping artifacts, ADRs. No application code. |
| **v1 against mock** | Runnable mock + API + tests. Operator can curl locally. |
| **v1 cutover** | Same binary, `CHATBOT_URL` + session file pointed at the owned clone. Selector verify pass. |
| **Later (P1)** | Multi-tab `sessionId`, HTTP streaming, Docker, extra API keys. |

v1 is done when the mock E2E suite is green and cutover is a config change plus a live smoke, not a rewrite.
