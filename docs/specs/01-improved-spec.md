# Chatbot-to-API Bridge — Engineering Spec (v1.1)

Hand this document to a coding agent as the implementation spec.

This supersedes [`00-original-build-prompt.md`](./00-original-build-prompt.md). The original is kept as the source of intent. Product intent: [`../PRD-chatbot-api.md`](../PRD-chatbot-api.md). DOM contract: [`02-chatgpt-dom-contract.md`](./02-chatgpt-dom-contract.md). Execution: [`../../IMPLEMENTATION_PLAN.md`](../../IMPLEMENTATION_PLAN.md).

**v1.2 (owner answers, 2026-08-30):** ChatGPT-faithful mock for the entire build; no live chatgpt.com scrape; session file instead of interactive login on the owned bot; New chat is a button; generation 3–5s; `HEADLESS` configurable; timeout returns text with `partial: true`.

---

## 0. Changelog vs original

| Gap in the original | What this spec adds |
|---|---|
| Login to the *target* chatbot is mentioned, not designed | Owner-supplied Playwright `storageState`; mock may have a ChatGPT-like login only to test injection |
| Selectors unknown, no discovery workflow | Mock chatbot for development + a `discover-selectors` script for the real UI |
| Pick *one* wait strategy | Hybrid wait: first-token → UI signal → text stability, all under a hard timeout |
| Timeout returns nothing | `partial: true` plus `response` text on HTTP 504 `TIMEOUT` |
| `sessionId` in the API, but v1 is one page | Accepted, echoed, ignored for routing in v1. Documented upgrade path |
| No test plan | Local mock ChatGPT-style page so the service is testable without the real UI |
| Error recovery is a bullet | Explicit recover steps so a failed request does not poison the next one |
| Weak ops story | Screenshots + Playwright traces on failure, structured logs, health payload |
| Stack left open | Locked: Node 20+, TypeScript, Express, Playwright, p-queue, zod, pino |
| Security is “an API key” | Bind localhost by default, prompt size cap, no prompt logging by default |
| No implementation order | Mock-first against ChatGPT DOM contract; owned URL is cutover, not a blocker for v1 code |
| Windows not mentioned | Target OS is Windows; Playwright + persistent profile paths must work there |

---

## 1. What we're building

A **Node.js** service that wraps an existing web chatbot UI (textarea or contenteditable, send button, scrolling message list) and exposes it as a small REST API.

It does **not** call a model vendor API. It drives a real Chromium/Chrome window with **Playwright**, the same way a human would: type, submit, wait until generation finishes, scrape the latest assistant message.

**Playwright is required.** Do not switch to Puppeteer. Reasons: auto-waiting locators, `getByRole`, tracing, persistent context, and crash events are all first-class.

**Intended use:** wrapping a chatbot you own or have permission to automate (internal tool, self-hosted UI, a site whose ToS allow this). Do not use this to bypass a vendor’s paid API or terms of service.

---

## 2. Decisions already made (do not re-litigate in v1)

| Decision | Choice | Why |
|---|---|---|
| Language | TypeScript, Node 20+ | Locators, timeouts, and error unions benefit from types |
| HTTP | Express | Original listed it first; enough for three endpoints |
| Browser | Playwright Chromium, one `launchPersistentContext` | Survives restarts with cookies/localStorage |
| Queue | `p-queue` concurrency `1`, bounded `QUEUE_MAX` | One page = one in-flight prompt |
| Validation | `zod` for env + request bodies | Fail fast on bad config |
| Logs | `pino` JSON logs, **prompts redacted by default** | This service will see every prompt |
| Wait strategy | Hybrid (section 8), never `page.waitForTimeout` as the done-signal | Fixed sleeps are the #1 bug |
| Multi-chat | Stretch. v1 = one page, one queue | Original said low-stakes |
| Streaming HTTP | Out of scope | Return full text when done |

---

## 3. High-level flow

```
API request
  → auth + validate
  → enqueue (or QUEUE_FULL)
  → (optional) new chat
  → recover-if-dirty
  → focus input, enter prompt, submit
  → wait until generation is actually finished
  → scrape last assistant message
  → JSON response
```

Browser process:

1. On process start, launch **one** persistent browser context and navigate to `CHATBOT_URL`.
2. Keep that context alive for the life of the process. Never launch a new browser per request.
3. If the page/context/browser dies, relaunch, re-navigate, log at `error`.
4. On `SIGTERM` / `SIGINT`, close the context cleanly then exit.

---

## 4. Session, not interactive login (owned bot)

The owner will provide a login session. The API process must **not** require a human to type credentials into the owned chatbot.

### 4.1 Persistent context + storageState

```ts
chromium.launchPersistentContext(USER_DATA_DIR, {
  headless: HEADLESS, // env-configurable; both modes required
  channel: BROWSER_CHANNEL || undefined,
  viewport: { width: 1400, height: 900 },
  storageState: fs.existsSync(STORAGE_STATE_PATH) ? STORAGE_STATE_PATH : undefined,
})
```

Do not use a throwaway context.

### 4.2 Startup assert

After `CHATBOT_URL` loads, `#prompt-textarea` (chat-ready) must be visible within `STARTUP_TIMEOUT_MS`. If a login wall is showing, mark health not-ready / `BROWSER_UNAVAILABLE`. Do not block the event loop in a 5-minute “please log in” wait inside the API server.

### 4.3 Mock-only login page

The local mock may include a ChatGPT-like `/auth/login` so tests can mint a `storageState`. `scripts/login.ts` runs against the **mock** (or, later, only if the owner asks). It is not the production path for the owned URL.

### 4.4 Headless

`HEADLESS=true|false` is a first-class config. Default `false` during build so operators can see the ChatGPT-like mock. Production may set `true` once the session file is proven.

Do **not** add stealth/evasion plugins in v1. Do **not** point this browser at chatgpt.com.

---

## 5. Selectors

Unknown DOM is a given. Treat selectors as **data**, not code.

### 5.1 Rules

- Every locator lives in `src/config/selectors.ts`. Zero CSS/xpath strings in `chat.ts`.
- Unverified locators are typed as such and tagged `verified: false`.
- Prefer Playwright role locators over brittle CSS (`getByRole('textbox')`, `getByRole('button', { name: /send/i })`). CSS/`data-testid` are fallbacks.
- Each selector has a **purpose** and at least one **fallback** where the UI might differ (textarea vs contenteditable, Send vs arrow icon).
- The last **assistant** message must be distinguishable from the user’s echoed prompt. If the DOM has no role attribute, define a structural rule (e.g. odd/even rows, avatar class, `data-author`) and document it.

### 5.2 Required selector keys

```ts
export type SelectorSet = {
  verified: boolean;
  loggedIn: LocatorDef;          // proves we are in the chat UI, not login
  newChat: LocatorDef;           // button or link
  promptInput: LocatorDef;       // textarea | contenteditable
  sendButton: LocatorDef;        // may be optional if enter-to-send works
  stopButton: LocatorDef;        // "stop generating" — primary done-signal
  sendButtonBusy: LocatorDef;    // send disabled / spinner — secondary done-signal
  messageList: LocatorDef;       // scroll container
  assistantMessages: LocatorDef; // all assistant bubbles; we take last()
  typingIndicator: LocatorDef;   // optional "..." / "thinking"
};
```

`LocatorDef` is `{ strategy: 'role' | 'css' | 'testId' | 'placeholder', value: string, name?: string, notes?: string }`.

### 5.3 Development without the real DOM

Do **not** invent a generic chat DOM. Implement the ChatGPT-faithful contract in [`02-chatgpt-dom-contract.md`](./02-chatgpt-dom-contract.md).

v1 must include a **local mock** (`scripts/mock-chatbot/`) as default `CHATBOT_URL`:

- Same landmarks/testids as the contract (`#prompt-textarea`, `data-message-author-role`, send/stop/new-chat testids)
- Contenteditable composer that only enables Send after a real `input` event (ProseMirror-like)
- Stream default **3000 ms**; `?delayMs=` for 5000 ms worst-case and timeout tests
- Stop visible while streaming; New chat is a **button**
- Optional `/auth/login` for session-injection tests

Automation is proven against this mock. Cutover is `CHATBOT_URL` + storageState, then a selector verify — not a rewrite. Never live-scrape chatgpt.com to “get the HTML”; the contract above is the freeze.

### 5.4 Discovery script (for the real UI)

`scripts/discover-selectors.ts`:

1. Launch persistent context, open `CHATBOT_URL`.
2. Wait for operator (headed).
3. Dump candidate locators: all `textarea`, `[contenteditable]`, buttons with accessible names matching `/send|submit|stop|new chat/i`, nodes with `data-message-author-role` / `data-testid`.
4. Write `artifacts/dom-snapshot.html` + a screenshot.
5. Print a starter `selectors.ts` fragment with `verified: false`.

The coding agent must not fill production selectors from imagination. If the real URL is not provided, ship mock selectors only.

---

## 6. Entering and submitting a prompt

UIs differ. Encode this as a small strategy, not a single `fill()`.

1. Wait for `promptInput` visible and enabled.
2. Click / focus it.
3. Clear existing text (Ctrl/Meta+A, Backspace, or `fill('')` — try fill first, fall back to keypress if the send button stays disabled).
4. Insert the prompt:
   - Try `locator.fill(prompt)` first (fast).
   - If `sendButton` stays disabled, use `pressSequentially` so React/Vue `input` events fire.
   - If the node is contenteditable / ProseMirror-like, do **not** only set `innerHTML`. Use `fill` if Playwright maps it; else `execCommand('insertText')` or a paste `ClipboardEvent` after focus. The mock will keep Send disabled unless `input` fires.
5. Submit:
   - If `SUBMIT_STRATEGY=click`, click `sendButton`.
   - If `enter`, press Enter.
   - Default `auto`: click if send is enabled, else Enter.
6. After submit, the input should clear or the user bubble should appear. If neither happens within `SUBMIT_ACK_MS` (default 3s), throw `SELECTOR_NOT_FOUND` / submit-failed rather than waiting 60s for a reply that was never sent.

Never paste a prompt so large the UI rejects it. Enforce `MAX_PROMPT_CHARS` at the HTTP layer first.

---

## 7. Identifying the last assistant message

After submit:

1. Note `assistantCountBefore` = number of `assistantMessages` locators.
2. Wait until that count is `>= assistantCountBefore + 1` **or** the last assistant node’s text is longer than before (some UIs mutate the same node).
3. Scrape `assistantMessages.last()`.
4. Return **inner text**, not innerHTML. Collapse excessive blank lines. Do not include UI chrome (“Copy”, “Regenerate”) if those are sibling buttons — prefer a child `data-content` / markdown body locator if one exists (`assistantMessageBody` optional key).

If the only new node is the user’s echo, keep waiting. Do not return the prompt as the “response”.

---

## 8. “Response finished” — normative algorithm

A fixed sleep is forbidden (`page.waitForTimeout` may only be used as a tiny poll interval, never as “generation should be done now”).

Implement **one** function: `waitForGenerationComplete(page, { startedAt, assistantLocator })`.

### Phase A — first token (`FIRST_TOKEN_TIMEOUT_MS`, default 8s)

Owner-observed generation is 3–5s end-to-end. First token should appear well before that.

Wait until any of:

- `stopButton` is visible, or
- `typingIndicator` is visible, or
- `sendButton` is disabled / `sendButtonBusy` matches, or
- assistant message count increased, or last assistant text length increased

If none of these happen in time → `TIMEOUT` (request never started). Attempt recover (section 10).

### Phase B — streaming done (remaining budget of `GENERATION_TIMEOUT_MS`, default 12s)

Typical 3s, worst 5s, plus ~1.2s stability polls and slack. Do not default to 60s — every queued request would stall on a hang.

Loop until **both** are true, or the budget is exhausted:

1. **UI idle signal** (if the selector exists in this DOM):
   - `stopButton` is hidden/detached, **and**
   - send button is enabled again, **and**
   - typing indicator is gone
2. **Text stability**: read assistant body text every `STABILITY_POLL_MS` (default 400ms). Require `STABILITY_CHECKS` (default 3) consecutive identical snapshots.

If the DOM has no stop button, skip (1) and rely on (2) plus send-button re-enable if present.

If text is still changing, do not declare done even if stop disappeared for one frame (some UIs hide Stop before the last markdown paint).

### Phase C — hard timeout

If the budget hits zero:

1. Try click `stopButton` if visible; wait up to 2s.
2. Scrape whatever assistant text exists.
3. Return HTTP **504** with `code: TIMEOUT`, `partial: true`, and `response` set to whatever assistant text was scraped (empty string if none). Callers must be able to see both the text and that it is incomplete. Do not hide the text in a separately named field only.
4. Run recover so the next queued job is not stuck behind a spinning Stop.

Do **not** use MutationObserver as the primary signal in v1. It is harder to debug and easy to wake on unrelated sidebar mutations. Keep it as a stretch alternative.

---

## 9. Concurrency

One Playwright page cannot type two prompts at once.

- `p-queue`: `concurrency: 1`, `timeout: GENERATION_TIMEOUT_MS + 15_000` (queue item timeout > generation timeout).
- `QUEUE_MAX` (default 10) = `queue.size + queue.pending`. If adding would exceed, reject immediately with `QUEUE_FULL` (HTTP 429). Do not let Node’s event loop hold an unbounded promise list.
- Each job gets a `requestId` (uuid) used in logs and artifacts.
- `sessionId` in v1: if omitted, use `"default"`. Echo it back. **Do not** open extra tabs. If a non-default `sessionId` is sent, still run on the single page and echo the value (so clients can start sending it before multi-tab exists). Log a debug note that v1 ignores session routing.

Stretch (not v1): map `sessionId` → tab/context, each with its own queue of concurrency 1.

---

## 10. Errors, HTTP mapping, recovery

### 10.1 Envelope

Success `200` (`partial` is always present; `false` here):

```json
{
  "response": "assistant text",
  "partial": false,
  "sessionId": "default",
  "durationMs": 4120,
  "requestId": "…",
  "meta": {
    "queueWaitMs": 12,
    "generationMs": 3980,
    "newChat": false
  }
}
```

Timeout `504` — text still included, flagged incomplete:

```json
{
  "error": "Generation timed out",
  "code": "TIMEOUT",
  "partial": true,
  "response": "whatever we scraped before the budget ran out",
  "requestId": "…"
}
```

Other errors: `{ "error", "code", "requestId", "partial": false, "response": "" }`.

### 10.2 Codes and status

| `code` | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | missing/empty prompt, over `MAX_PROMPT_CHARS`, bad JSON |
| `UNAUTHORIZED` | 401 | missing/wrong `x-api-key` |
| `QUEUE_FULL` | 429 | queue at cap |
| `TIMEOUT` | 504 | first-token or generation budget exceeded |
| `SELECTOR_NOT_FOUND` | 502 | required locator missing/hidden past Playwright timeout |
| `EMPTY_RESPONSE` | 502 | finished according to wait, but assistant text is empty |
| `BROWSER_UNAVAILABLE` | 503 | browser dead and relaunch failed, or not logged in |
| `UNKNOWN` | 500 | anything else — log stack, do not leak it to the client |

Do not crash the process on selector failures.

### 10.3 Recovery (must run after timeout, selector failure, or empty response)

Best-effort, each step skipped if selector missing:

1. If `stopButton` visible → click it, wait until gone (2s).
2. If a modal/dialog is visible → press Escape once.
3. Clear the prompt input.
4. If the page is `crash`ed / closed → relaunch path (section 11).
5. If recover fails twice in a row → navigate to `CHATBOT_URL` (or click New chat) as last resort.

Always write on failure (if `ARTIFACTS_ON_ERROR=true`, default true):

- `artifacts/<requestId>/screenshot.png`
- `artifacts/<requestId>/trace.zip` (Playwright tracing started at job start, stopped in `finally`)
- log path to both

---

## 11. Browser lifecycle

`src/automation/browser.ts` owns:

- `start()` / `stop()`
- `getPage(): Page` (throw `BROWSER_UNAVAILABLE` if none)
- `isAlive(): boolean`
- relaunch with backoff (e.g. 1s, 2s, 5s; cap 3 attempts per incident)
- listeners: `page.on('crash')`, `page.on('close')`, `context.on('close')`, `browser.on('disconnected')`
- navigate to `CHATBOT_URL` with `NAVIGATION_TIMEOUT_MS`
- after navigate, assert `selectors.loggedIn` (or mock equivalent)

Relaunch must reuse `USER_DATA_DIR` so the session survives.

Startup must not hang forever: if the chat UI is not ready in `STARTUP_TIMEOUT_MS`, exit or flip health to not-ready (choose not-ready + process stays up, so ops can inspect; document it).

---

## 12. HTTP API

Base URL local. Default `HOST=127.0.0.1`, `PORT=8787`.

Auth: header `x-api-key` must equal `API_KEY`. Apply to all routes except `GET /health` (health stays unauthenticated so a supervisor can probe it; it must **not** leak the API key or prompt text).

### `POST /chat/send`

Body: `{ "prompt": string, "sessionId"?: string }`

Sends into the currently open chat.

### `POST /chat/new`

Same body. Clicks the New chat **button**, waits for a clean composer, then same as send. Do not use URL navigation as the primary New chat mechanism.

If New chat fails, do not send the prompt into the old thread. Return `SELECTOR_NOT_FOUND`.

### `GET /health`

```json
{
  "ok": true,
  "browser": { "alive": true, "loggedIn": true, "url": "http://…" },
  "queue": { "size": 0, "pending": 1, "max": 10 },
  "lastSuccessAt": "ISO-8601 or null",
  "lastError": { "at": "ISO", "code": "TIMEOUT", "message": "…" } | null,
  "uptimeMs": 12345
}
```

`ok` is true only if `browser.alive && browser.loggedIn`. Queue backup does not flip `ok` to false (it is still serving). Clients that need to shed load should read `queue.size`.

No other routes in v1.

---

## 13. Config (`.env.example`)

```
API_KEY=change-me
HOST=127.0.0.1
PORT=8787

CHATBOT_URL=http://127.0.0.1:4173/   # mock by default; owned URL at cutover
HEADLESS=false                       # true | false — both supported
BROWSER_CHANNEL=chrome
USER_DATA_DIR=./data/browser-profile
STORAGE_STATE_PATH=./data/storage-state.json

QUEUE_MAX=10
MAX_PROMPT_CHARS=8000

NAVIGATION_TIMEOUT_MS=30000
STARTUP_TIMEOUT_MS=30000
SUBMIT_ACK_MS=3000
FIRST_TOKEN_TIMEOUT_MS=8000
GENERATION_TIMEOUT_MS=12000
STABILITY_POLL_MS=400
STABILITY_CHECKS=3

SUBMIT_STRATEGY=auto
ARTIFACTS_ON_ERROR=true
LOG_PROMPTS=false
```

Validate with zod at boot. Missing `API_KEY` or `CHATBOT_URL` → exit 1.

---

## 14. Project layout

```
src/
  index.ts                 # boot: env, mock optional, browser.start, listen, shutdown
  server.ts                # express app, routes, auth middleware
  automation/
    browser.ts             # launch, keep-alive, relaunch
    chat.ts                # new chat, fill, submit, scrape
    wait-for-response.ts   # section 8
    recover.ts             # section 10.3
    queue.ts               # p-queue wrapper + QUEUE_FULL
  config/
    env.ts                 # zod env
    selectors.ts           # locator defs (mock verified; real TODO)
  lib/
    errors.ts              # AppError with code
    logger.ts              # pino
scripts/
  mock-chatbot/            # static HTML+JS (or tiny express static)
  discover-selectors.ts
  login.ts
tests/
  api.test.ts              # health, auth, validation, queue full (mocked automation)
  wait-for-response.test.ts
  e2e-mock.test.ts         # real Playwright against mock chatbot
artifacts/                 # gitignored
data/                      # gitignored browser profile
.env.example
README.md
```

Keep the original’s spirit (server / browser / chat / selectors) but use `src/` and split wait + recover so `chat.ts` does not become a god file.

---

## 15. Implementation phases (coding agent order)

Do not start with the real chatbot URL. Build in this order so each phase is demoable.

**Phase 0 — scaffold**  
package.json, tsconfig, env, logger, gitignore (`data/`, `artifacts/`, `node_modules/`).

**Phase 1 — ChatGPT-faithful mock**  
Runnable locally (`npm run mock`). Same testids as the DOM contract. Manual check: type, 3s stream, Stop, New chat button.

**Phase 2 — browser + chat against mock**  
`browser.ts` + `chat.ts` + wait + recover. A `npm run smoke` script: start mock, send one prompt, print the reply, exit.

**Phase 3 — HTTP + queue + auth**  
Three endpoints, health payload, QUEUE_FULL, zod validation.

**Phase 4 — failure modes**  
Force timeout via `?delayMs=`; kill the page mid-request and confirm relaunch; missing selector returns `SELECTOR_NOT_FOUND` without process exit; artifacts written.

**Phase 5 — real UI (blocked)**  
Requires answers in section 18. Run `discover-selectors`, fill `selectors.ts`, headed login, one manual smoke, then mark `verified: true`.

---

## 16. Test plan

### Automated (required for v1)

- `GET /health` 200, shape as specified.
- Missing/wrong API key → 401 `UNAUTHORIZED` on POST.
- Empty prompt / oversize → 400 `VALIDATION_ERROR`.
- Mock e2e: `POST /chat/send` returns the mock’s canned assistant text (not the user prompt).
- Mock e2e: `POST /chat/new` clears history then replies.
- Mock with `delayMs` above budget: 504 `TIMEOUT`, `partial: true`, non-empty `response`, and the next request still succeeds.
- Queue: fill with `QUEUE_MAX` hanging jobs (generation delayed), next call is 429 `QUEUE_FULL`.
- Selector: point at a dummy page without the input → `SELECTOR_NOT_FOUND`, process still up.

### Manual (real UI, phase 5)

- Headed login persists across service restart.
- A 1-sentence prompt returns a full answer (not truncated).
- A long answer (~30s stream) is not cut off.
- After a timeout, a following prompt works.

---

## 17. README requirements

Short. Must include:

1. What it is (browser bridge, not an official API).
2. `npm install`, `npx playwright install chromium`, copy `.env.example`, `npm run mock` in one terminal, `npm run dev` in another, curl example with `x-api-key`.
3. How to switch from mock to a real URL: login script, discover-selectors, edit `selectors.ts`, set `verified: true`.
4. How to debug a flake: open `artifacts/<requestId>/trace.zip` in `npx playwright show-trace`.
5. Limitation: one in-flight generation; `QUEUE_FULL` is expected under burst traffic.
6. Permission/ToS note: only automate UIs you are allowed to.

---

## 18. Open questions — resolved 2026-08-30

| # | Question | Answer | Effect |
|---|----------|--------|--------|
| 1 | Chatbot URL? | Owner-owned clone; URL given at cutover, not now | Build 100% on ChatGPT-faithful mock |
| 2 | Permission? | Owner owns it | Never automate chatgpt.com |
| 3 | Login? | Session file provided; mock may have ChatGPT-like login for tests | No interactive login in the API process |
| 4 | New chat? | **Button** | `data-testid="new-chat-button"` |
| 5 | Generation time? | Typical 3s, worst ~5s | `GENERATION_TIMEOUT_MS=12000` |
| 6 | Headless? | **Both**, env-configurable | `HEADLESS=true\|false` |
| 7 | Partial on timeout? | Yes, and **must flag** it | `partial: true` + `response` on 504 |
| 8 | Multi-session v1? | Unchanged: echo `sessionId`, one page | Stretch |

Still pending (blocks **cutover only**): the concrete owned URL and the session file.

---

## 19. Stretch (explicitly out of v1)

- Multiple tabs keyed by `sessionId`
- SSE/streaming tokens back to the API client
- Horizontal scaling / browser pool
- Stealth / anti-bot evasion
- Per-user API keys, JWT, rate limit beyond queue cap
- MutationObserver-based wait
- Capturing images/files from the assistant, or sending attachments
- Docker (Playwright + Chrome on Windows-first v1 is enough; Linux container later)

---

## 20. Definition of done (v1)

- [ ] Mock chatbot runs locally
- [ ] `POST /chat/send` and `POST /chat/new` return assistant text from the mock
- [ ] Hybrid wait (section 8) used; no fixed “sleep 3s then scrape”
- [ ] Queue concurrency 1; `QUEUE_FULL` at cap
- [ ] Health reports browser + queue
- [ ] API key on mutating routes
- [ ] Crash → relaunch + re-navigate
- [ ] Timeout → recover + `partial: true` + `response` text + artifacts
- [ ] Selectors isolated; mock set `verified: true`; real set `verified: false` until discovered
- [ ] README can get a stranger from clone to a successful curl against the mock
- [ ] `.env.example` complete
- [ ] Unit/e2e tests in section 16 pass
