# Flows — Chatbot-to-API Bridge

Load-bearing paths only (auth, data leaving the process, operational safety).

---

## F1 — Send prompt (happy path)

- **Actor:** API client
- **Precondition:** process up, browser alive, chat-ready, that key’s queue not full, valid `x-api-key`
- **Success:** HTTP 200, `partial: false`, `response` is last assistant `.markdown.prose` text

1. Client POST `/chat/send` `{ prompt }` + `x-api-key`.
2. **Authz:** key in allowlist (`API_KEYS` / `API_KEY`) or 401.
3. Rate limit (10 rpm default per key) or 429 `RATE_LIMITED`.
4. Validate body or 400.
5. Resolve **page slot for that key** (lazy bind; first use → New chat). Enqueue on that page’s queue or 429 `QUEUE_FULL`.
6. Insert into `#prompt-textarea` (real input), wait for send, submit.
7. Hybrid wait within `GENERATION_TIMEOUT_MS`.
8. Scrape last `[data-message-author-role="assistant"]` body.

**Deny:** wrong key → 401, no browser action. Same key continues the thread; different keys never share a page.

---

## F2 — New chat (scoped to key)

1. Authz + rate limit as F1.
2. Click `a[data-testid="create-new-chat-button"]` on **that key’s page only**.
3. Other keys’ threads untouched.

---

## F3 — Generation timeout with partial text

1. Budget exceeded → click stop if visible → scrape → HTTP 504, `partial: true`, `response` filled.
2. Next request on the same key soft-recovers (does not steal another key’s page).

---

## F4 — Health

Unauthenticated. Returns up/pagesBound/maxPages. No secrets.

---

## F5 — Multi-key isolation

1. Key A and key B each get their own page (`MAX_PAGES` ≥ 2).
2. First request per key always New chat.
3. Parallel generations allowed across keys; serialized per key.
