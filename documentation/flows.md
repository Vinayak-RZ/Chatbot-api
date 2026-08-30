# Flows — Chatbot-to-API Bridge

Load-bearing paths only (auth, data leaving the process, operational safety). Not a feature catalog.

---

## F1 — Send prompt (happy path)

- **Actor:** API client
- **Precondition:** process up, browser alive, chat-ready, queue not full, valid `x-api-key`
- **Success:** HTTP 200, `partial: false`, `response` is last assistant `.markdown.prose` text

1. Client POST `/chat/send` `{ prompt }` + `x-api-key`.
2. **Authz:** API key equals `API_KEY` or 401. Trust boundary: client → server.
3. Validate body (non-empty, `MAX_PROMPT_CHARS`) or 400.
4. Enqueue or 429 `QUEUE_FULL`.
5. Playwright focuses `#prompt-textarea`, inserts prompt (input event required), clicks send or Enter.
6. Wait: stop-button / first token, then stop gone + text stable, budget `GENERATION_TIMEOUT_MS`.
7. Scrape `[data-message-author-role="assistant"]` last body’s innerText.
8. Return JSON. Side effect: none beyond the chat UI thread growing.

**Deny:** wrong key → 401, no browser action.

---

## F2 — New chat then send

- **Actor:** API client
- **Precondition:** same as F1
- **Success:** thread cleared, then F1 success; `meta.newChat: true`

1. Same authz as F1.
2. Click `button[data-testid="new-chat-button"]`. If it fails, **do not** send into the old thread (`SELECTOR_NOT_FOUND`).
3. Continue F1 from insert.

**Deny:** missing New chat control → 502, no send.

---

## F3 — Generation timeout with partial text

- **Actor:** API client
- **Precondition:** mock/owned UI streams longer than budget (or hung stop)
- **Success (degraded):** HTTP 504, `code: TIMEOUT`, `partial: true`, `response` = scraped text (may be empty)

1. Same as F1 through submit.
2. Budget expires → click Stop if visible → scrape → recover (clear composer).
3. Write `artifacts/<requestId>/` if enabled.

**Safety:** next queue job must not see a stuck Stop button.

---

## F4 — Health probe

- **Actor:** supervisor / human
- **Precondition:** process listening
- **Success:** 200 JSON; `ok` true only if browser alive and chat-ready

No API key. Must not include prompts, API key, or storageState.

**Deny:** N/A (open). Abuse: bind localhost so the open health port is not public.

---

## F5 — Session injection at boot

- **Actor:** operator
- **Precondition:** `STORAGE_STATE_PATH` file present (owner-supplied or mock-minted)
- **Success:** after navigate, composer visible; health `loggedIn: true`

1. `launchPersistentContext` with optional `storageState`.
2. Goto `CHATBOT_URL`.
3. Assert `#prompt-textarea`. If login page: health not-ready, no traffic that types into a login form.

**Trust boundary:** secrets on disk (`data/`) → browser cookie jar. Never log cookie values.

---

## F6 — Browser crash mid-request

- **Actor:** process
- **Precondition:** page crash/close event
- **Success:** relaunch with same profile, re-navigate, in-flight job fails `BROWSER_UNAVAILABLE` or `UNKNOWN`; queue continues

Side effect: loud error log, optional artifact if page still capturable.
