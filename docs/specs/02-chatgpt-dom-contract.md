# ChatGPT-faithful DOM contract (mock + owned clone)

This is the selector and behavior contract for:

1. The **local mock** (all build phases until cutover)
2. The **owned chatbot**, which the owner states is ChatGPT-similar
3. Playwright locators in `src/config/selectors.ts`

It is **not** a license to drive chatgpt.com. We do not live-scrape or automate OpenAI’s site. The mock is a **sanitized structural clone** of ChatGPT UI landmarks (from an owner-provided dump with secrets stripped).

**Security:** Never commit `#client-bootstrap`, JWTs, session cookies, real emails, or real chat history from any dump.

---

## 1. Layout (must exist in the mock)

```text
┌────────────────────┬──────────────────────────────────────────┐
│ #stage-slideover-  │  main#main                               │
│ sidebar            │    #thread                               │
│                    │      [data-message-author-role=user]     │
│ [New chat] link    │      [data-message-author-role=assistant]│
│ nav Chat history   │        .markdown.prose                   │
│ #history           │                                          │
│                    │  form[data-type=unified-composer]        │
│                    │    #prompt-textarea.ProseMirror          │
│                    │    send-button | stop-button | voice     │
└────────────────────┴──────────────────────────────────────────┘
```

Optional mock-only login at `/auth/login` to mint `storageState` in tests.

---

## 2. Canonical locators

| Purpose | Canonical | Fallbacks |
|---------|-----------|-----------|
| Logged-in / chat ready | `#prompt-textarea` visible in `main#main` | `main[role="main"]` + composer |
| New chat | `a[data-testid="create-new-chat-button"]` | accessible name `/new chat/i`; legacy `button[data-testid="new-chat-button"]` |
| Composer | `#prompt-textarea.ProseMirror[contenteditable="true"]` | `div[role="textbox"][contenteditable="true"]` |
| Hidden mirror | `textarea[name="prompt-textarea"]` | — |
| Send | `button[data-testid="send-button"]` | `button[aria-label*="Send" i]` |
| Stop | `button[data-testid="stop-button"]` | `button[aria-label*="Stop" i]` |
| Plus | `button[data-testid="composer-plus-btn"]` | — |
| User turn | `[data-message-author-role="user"]` | — |
| Assistant turn | `[data-message-author-role="assistant"]` | — |
| Assistant body | `[data-message-author-role="assistant"] .markdown.prose` | the assistant node |

---

## 3. Behavioral contract

### Composer

- Empty → **Voice** visible; **no send-button**.
- After real `input`/`beforeinput` with text → `send-button` visible and enabled.
- Enter submits (Shift+Enter = newline).
- After submit, composer clears.
- While generating: Stop visible; Send hidden/disabled.
- Naive `innerHTML` without `input` event must **not** enable Send.

### Streaming

- Default **3000 ms**; `?delayMs=` for tests.
- Tokens append into last assistant `.markdown.prose`.
- Stop ends stream; leftover text stays (partials).

### New chat

- Control (link/button), not required URL navigation.
- Clears `#thread` messages, focuses composer.
- **API rule:** first use of an API key always triggers New chat before insert; same key continues on later sends.

### Assistant vs user

- Always scrape `[data-message-author-role="assistant"]` (last). Never last list child blindly.

---

## 4. Fidelity bar

**Required:** landmarks, testids, roles, streaming/stop, create-new-chat, composer enable rules.  
**Forbidden:** different testids that break cutover; committing secrets from dumps; hotlinking OpenAI CDNs for required assets.

---

## 5. Login session (owned bot)

1. Start persistent context.
2. If `STORAGE_STATE_PATH` exists, load it.
3. Navigate to `CHATBOT_URL`.
4. Assert chat-ready. If login page showing → fail health; do not interactive-login in the API process.

Mock `/auth/login` exists so tests can generate storageState.
