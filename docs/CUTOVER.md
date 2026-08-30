# Cutover notes (Phase H)

## Take over a logged-in Chrome window (recommended)

Playwright **cannot** hijack a normal Chrome you already opened. Chrome must be started with **remote debugging**. Your login is kept if you use a dedicated profile (script below) and log in once there.

### Steps

1. **Close all Chrome windows** (required — Chrome locks the profile otherwise).
2. Start a debug Chrome:

```powershell
.\scripts\chrome-debug.ps1 -Url "https://YOUR-OWNED-CHATBOT/"
```

3. Log in in that window if needed; leave the chatbot tab open.
4. In `.env`:

```env
CDP_URL=http://127.0.0.1:9222
CHATBOT_URL=https://YOUR-OWNED-CHATBOT/
HEADLESS=false
API_KEY=dev-key-change-me
```

5. Run the API (it attaches to that Chrome; it will not kill Chrome on exit):

```powershell
npm run dev
```

6. Send a prompt:

```powershell
curl -X POST http://127.0.0.1:8787/chat/send -H "content-type: application/json" -H "x-api-key: dev-key-change-me" -d "{\"prompt\":\"hello\"}"
```

The bridge reuses a tab already on `CHATBOT_URL` when `CDP_REUSE_TABS=true` (default). The first request for an API key still clicks **New chat** so keys do not inherit random thread context.

## What you need to supply

1. **Chatbot URL** (owned clone — not `chatgpt.com`)
2. Either CDP attach (above) **or** a Playwright `storageState` JSON at `STORAGE_STATE_PATH`
3. Confirm UI landmarks: New chat, `#prompt-textarea`, Send/Stop, `[data-message-author-role="assistant"]`
4. Optional: `API_KEYS` + `MAX_PAGES` (1–3)

## Alternate: storageState file (no CDP)

1. Set `CHATBOT_URL` and leave `CDP_URL` empty.
2. Place session JSON at `./data/storage-state.json`.
3. `HEADLESS=false` → Playwright opens its own window with those cookies.
4. `npm run smoke` then `/chat/send`.

## Out of scope forever

- Automating or scraping `chatgpt.com`
- Committing live tokens / bootstrap JSON / `.env`
