# ChatGPT-faithful DOM contract (mock + owned clone)

This is the selector and behavior contract for:

1. The **local mock** (all build phases until cutover)
2. The **owned chatbot**, which the owner states is ChatGPT-similar
3. Playwright locators in `src/config/selectors.ts` (implementation phase)

It is **not** a license to drive chatgpt.com. We do not live-scrape or automate OpenAI’s site. The mock **reimplements** publicly documented ChatGPT UI landmarks so selectors learned on the mock survive a URL swap.

Sources for landmarks (public, third-party notes — not an official OpenAI schema):

- ChatGPT message nodes: `[data-message-author-role="user"|"assistant"]`
- Composer: `#prompt-textarea` (historically a `<textarea>`, later a ProseMirror `contenteditable`)
- Send: `button[data-testid="send-button"]`
- Markdown body: `.markdown.prose` inside the assistant node
- Main landmark: `main[role="main"]`

---

## 1. Layout (must exist in the mock)

```text
┌────────────┬──────────────────────────────────────────┐
│ Sidebar    │  Main [role=main]                        │
│            │                                          │
│ [New chat] │  Message list (scroll)                   │
│            │    [data-message-author-role=user]       │
│ History    │    [data-message-author-role=assistant]  │
│ (optional) │      .markdown.prose                     │
│            │                                          │
│            │  Composer form                           │
│            │    #prompt-textarea[contenteditable]     │
│            │    [data-testid=send-button]             │
│            │    [data-testid=stop-button] (streaming) │
└────────────┴──────────────────────────────────────────┘
```

Optional mock-only login (ChatGPT-shaped, not pixel-perfect OpenAI branding):

- Path `/auth/login`
- Email + password fields, Continue / Log in button
- On success: set a session cookie and redirect to `/`
- Chat UI is the **logged-in** proof (`#prompt-textarea` visible)

---

## 2. Canonical locators (mock must implement these exact hooks)

| Purpose | Canonical (mock + target) | Fallbacks (automation may try in order) |
|---------|---------------------------|-----------------------------------------|
| Logged-in / chat ready | `#prompt-textarea` visible in `main` | `main[role="main"]` + composer |
| New chat | `button[data-testid="new-chat-button"]` | `button` / `a` with accessible name `/new chat/i` |
| Composer | `#prompt-textarea[contenteditable="true"]` | `div[role="textbox"][contenteditable="true"]`, then `textarea#prompt-textarea` |
| Send | `button[data-testid="send-button"]` | `button[aria-label*="Send" i]` |
| Stop generating | `button[data-testid="stop-button"]` | `button[aria-label*="Stop" i]` |
| Message list | `[data-testid="conversation-panel"]` | `main[role="main"]` |
| User turn | `[data-message-author-role="user"]` | — |
| Assistant turn | `[data-message-author-role="assistant"]` | — |
| Assistant body | `[data-message-author-role="assistant"] .markdown.prose` | the assistant node itself |
| Typing / thinking | `[data-testid="typing-indicator"]` | optional |

`verified: true` on the mock set. After cutover, re-verify against the owned URL; if a hook is missing, add a fallback in `selectors.ts` without changing the mock contract unless both sides change.

---

## 3. Behavioral contract (ChatGPT-like)

### Composer

- Empty composer → Send **disabled**.
- Non-empty composer → Send **enabled**.
- Enter submits (Shift+Enter = newline).
- After successful submit, composer clears.
- While generating: Send is **not** shown as the primary action; **Stop** is visible; Send is disabled or replaced.

**Insert rule for automation:** ChatGPT-like editors often ignore `element.textContent = …`. The mock should behave like ProseMirror: either listen to `input`/`beforeinput`, or document that Playwright must `click`, then `execCommand('insertText')` or a paste `ClipboardEvent`, not only set innerHTML. The mock must enable Send only after a real input event, so a naive innerHTML set that does **not** dispatch `input` leaves Send disabled. That forces the automation to use the same insert path the owned UI will need.

### Streaming

- Default mock generation duration: **3000 ms** (typical).
- Support `?delayMs=5000` (worst case) and higher for timeout tests.
- Tokens append into the last assistant `.markdown.prose`.
- Stop button visible for the whole stream.
- Clicking Stop ends the stream immediately; leftover text stays (this is how we produce partials).

### New chat

- **Button**, not a required URL navigation (owner confirmed).
- Clears the message list, focuses composer, does not send by itself.

### Assistant vs user

- Never scrape the last node in the list blindly. Always `data-message-author-role="assistant"`.
- Copy / Regenerate controls must sit **outside** `.markdown.prose` so innerText of the body is clean.

---

## 4. What the mock must look like (fidelity bar)

**Required (automation depends on it):** landmarks, testids, roles, streaming/stop, new-chat button, composer enable rules.

**Required-enough visually:** ChatGPT-like layout (left rail, wide thread, bottom composer), light surface, simple sans type. Not a pixel-perfect OpenAI clone. No OpenAI logos or trademarks.

**Forbidden:** inventing different testids (`data-role` instead of `data-message-author-role`, `#chat-input` instead of `#prompt-textarea`) and hoping cutover still works.

---

## 5. Login session (owned bot)

The owned chatbot has a login, but the operator **supplies a session**. Automation v1:

1. Start persistent context.
2. If `STORAGE_STATE_PATH` exists, load it (Playwright `storageState`).
3. Navigate to `CHATBOT_URL`.
4. Assert chat-ready (`#prompt-textarea`). If the login page is showing, fail health with `BROWSER_UNAVAILABLE` / not logged in — do **not** sit in an interactive login loop in the API process.

The mock login page exists only so we can **generate** a storageState in tests (`scripts/login.ts` against the mock). Interactive ChatGPT-like login is not the production path for the owned URL.

---

## 6. Cutover checklist (when the owner URL arrives)

- [ ] Owner provides URL + `storageState` (or cookie JSON we convert)
- [ ] Headed smoke: page shows composer, not login
- [ ] `discover-selectors` dump vs this contract — note diffs
- [ ] One `POST /chat/send`, one `POST /chat/new`
- [ ] A ~5s generation is not marked `partial`
- [ ] Mark owned selector set verified or patch fallbacks

---

## 7. Explicit non-action

Do not open chatgpt.com in Playwright for this project. The replica is local. The production target is the owner’s clone.
