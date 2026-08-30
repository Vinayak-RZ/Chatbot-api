# Build Prompt: Chatbot-to-API Bridge via Browser Automation

Give this whole document to a coding agent (Claude Code, Cursor, etc.) as the task spec.

## 1. What we're building

A Node.js backend service that turns an existing web-based chatbot UI (ChatGPT-style: a text input, a send button, a scrolling message list) into a REST API, by driving a real browser against that UI instead of calling any underlying model API directly.

The service should use **Playwright** (preferred over Puppeteer — better auto-waiting, more reliable selectors, built-in tracing for debugging flaky UI automation). If the agent strongly prefers Puppeteer, note the tradeoff explicitly before choosing.

## 2. High-level flow

1. On startup, launch one persistent browser instance and log into / navigate to the chatbot UI. Keep this browser alive for the life of the service (don't relaunch per request — that's slow and will break session/auth state).
2. A request comes in with a prompt.
3. The automation layer:
   - Focuses the chat input box
   - Types (or fills) the prompt
   - Submits it (click send button, or press Enter — whichever the actual UI needs)
   - **Waits for the response to actually finish generating** — see Section 5, do not just sleep a fixed 3 seconds
   - Scrolls to the bottom of the message list
   - Extracts the text of the latest assistant message
4. Returns that text as the JSON response body.

## 3. API surface

| Method | Path | Behavior |
|---|---|---|
| `POST /chat/send` | Sends `prompt` into the currently open/active chat and returns the reply. Optional `sessionId` if you support multiple parallel logical chats (see Section 6). |
| `POST /chat/new` | Starts a new chat (click "New chat" / navigate to fresh chat URL), then sends `prompt`, returns the reply. |
| `GET /health` | Returns browser/session status — is the page alive, is the automation queue backed up, etc. |

Request body: `{ "prompt": "string", "sessionId": "optional string" }`
Response body: `{ "response": "string", "sessionId": "string", "durationMs": number }`
Error response: `{ "error": "string", "code": "TIMEOUT" | "SELECTOR_NOT_FOUND" | "QUEUE_FULL" | "UNKNOWN" }`

Auth: require a simple API key via `x-api-key` header, checked against an env var. This is a bare-minimum protection since this service can be used to spam whatever chatbot it's driving.

## 4. Selectors are unknown — the agent must discover them

I have not given you the actual chatbot's HTML/DOM. Before writing automation logic, the agent should:
- Ask for the chatbot's URL, or inspect it if given access
- Identify: the input element (textarea/contenteditable div), the send button (or confirm Enter-to-send works), the container that holds messages, and a reliable way to identify "the last assistant message" (not the last message overall, since that could be the user's own prompt echoed back)
- Put every selector in a single config file/object (e.g. `config/selectors.js`) rather than hardcoding them inline, so they're easy to update when the chatbot's UI changes

Do not guess plausible-looking selectors and ship them as if they're verified — placeholder selectors should be clearly marked `// TODO: verify against actual DOM`.

## 5. Detecting "response finished" — don't use a fixed sleep

A fixed 3-second wait is the single most likely source of bugs here: too short and you'll scrape a half-streamed answer, too long and every request is needlessly slow. Use one of these instead, in order of preference:

1. **UI state signal**: most chat UIs show a "stop generating" button or a disabled/enabled toggle on the send button while streaming. Poll for that element to disappear / re-enable.
2. **DOM stability polling**: repeatedly read the last message's text content every ~300–500ms; once it stops changing for 2 consecutive checks, treat it as done. Add a max timeout (e.g. 30–60s) so a stuck request fails cleanly instead of hanging forever.
3. **MutationObserver via `page.evaluate`**: inject an observer on the message container and resolve a promise when mutations stop for N ms.

Whichever is used, wrap it in a hard timeout so one hung generation doesn't block the whole service (see Section 6).

## 6. Concurrency: a single browser page can only do one thing at a time

Browser automation against one open chat is inherently single-threaded — you can't send two prompts into the same input box simultaneously. The agent should:
- Put a request queue in front of the browser automation (e.g. a simple in-memory FIFO with a max queue length, or a lib like `p-queue`)
- Process one request fully (send → wait → scrape) before starting the next
- Return a `QUEUE_FULL` error if the queue exceeds a configurable max, rather than accepting unbounded backlog
- If real multi-chat support is wanted later, the upgrade path is multiple browser tabs/contexts (one per `sessionId`), each independently automated — flag this as a stretch goal, not required for v1 given the chatbot is described as low-stakes/basic

## 7. Error handling

- Selector not found → clear `SELECTOR_NOT_FOUND` error, don't crash the process
- Generation timeout → `TIMEOUT` error, and make sure the page is left in a usable state for the next request (e.g. don't leave a stuck "stop generating" state)
- Browser/page crash → detect via Playwright's page/context close events, auto-relaunch the browser and re-navigate, log it loudly

## 8. Non-goals for v1 (per current requirements)

- No need for horizontal scaling / multiple browser instances — the chatbot being automated is described as low-cost/basic, so a single persistent browser + request queue is sufficient
- No need for streaming responses back to the API caller — return the full text once generation is done
- No need for user-level auth beyond a single shared API key

## 9. Deliverables expected from the agent

1. `server.js` (or `src/index.ts`) — Express (or Fastify) app with the three endpoints
2. `automation/browser.js` — browser lifecycle (launch, keep-alive, relaunch on crash)
3. `automation/chat.js` — the send/wait/scrape logic described in Sections 4–5
4. `config/selectors.js` — all UI selectors in one place, clearly marked as needing verification
5. `.env.example` — API key, chatbot URL, timeouts, queue size, headless true/false
6. A short `README.md` explaining how to run it and how to update selectors when the chatbot UI changes
