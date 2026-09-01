# Cutover notes (Phase H)

## Attach to a pre-opened Chrome or Edge (recommended)

The API does **not** launch a browser. You open Chrome/Edge yourself, enable remote debugging, and the process attaches to **one designated tab**. Other tabs are never listed, logged, screenshotted, or searched for a chat box.

Playwright still cannot drive a Chromium window with debugging **off**. Chrome 144+: you can turn debugging on in an already-open window (no restart).

### Steps

1. Open Chrome or Edge yourself. Bring the ChatGPT-like tab to the **front** (or set `CHATBOT_URL` — see below).
2. Enable remote debugging:
   - Chrome: `chrome://inspect/#remote-debugging` → **Allow remote debugging for this browser instance** → click **Allow** when prompted.
   - Edge: `edge://inspect/#remote-debugging` (same toggle).
3. In `.env` (edit it yourself — the app never writes this file):

```env
BROWSER_MODE=attach
CDP_URL=chrome
CDP_ATTACH_TAB=focused
HEADLESS=false
API_KEY=dev-key-change-me
```

Use `CDP_URL=msedge` for Edge. Or `CDP_URL=http://127.0.0.1:9222` if you started a debug-port browser.

4. Run the API (it attaches; it will not kill Chrome on exit):

```powershell
npm run dev
```

If the API sits on **Connecting to existing browser over CDP** after you click Allow, that is the handshake (not the WebSocket). Close tabs stuck on a spinner, close the `chrome://inspect` page after the toggle is on, and restart `npm run dev`. You should see **CDP handshake starting** then **Attached to CDP browser**.

Attach drive (Chrome 144+ / background window) does **not** use Playwright click/fill on the composer. After attach you should see, in order:

1. `Attached to CDP browser`
2. `Remembered front tab` and/or `Bound selected tab` / `Bound focused tab`
3. `Inserted prompt into composer` — **hello** (or your prompt) must be in the box
4. scrape progress (`Scrape baseline after insert`, then wait logs) or a 502 scrape hint

`tsx` does not reload: Ctrl+C and `npm run dev` again after pulling code.

5. Send a prompt:

```powershell
curl -X POST http://127.0.0.1:8787/chat/send -H "content-type: application/json" -H "x-api-key: dev-key-change-me" -d "{\"prompt\":\"hello\"}"
```

### Which tab is driven

- **`CDP_ATTACH_TAB=focused` (default):** the selected tab in your Chrome window. You can switch to a terminal to send the request — Chrome does not need OS focus. If that tab is not a ChatGPT-like UI (`#prompt-textarea`), the request fails and the page is left untouched. Background tabs are not inspected.
- **`CDP_ATTACH_TAB=url`:** set `CHATBOT_URL` to the page you opt in. Only a tab on that origin is eligible. If none matches, the API fails closed — it does not crawl other tabs or navigate a personal page.

`CHATBOT_URL` is optional in focused attach mode. Extra API keys (`MAX_PAGES` > 1) get **new** tabs the API creates (they can open `CHATBOT_URL` if you set it); they do not adopt other tabs you already had open.

The first `/chat/send` on an **adopted** (already-open) tab continues that thread — it does not click **New chat** or open another tab. Use `POST /chat/new` when you want a fresh thread on that tab. Tabs the API creates itself still start with **New chat**.

On shutdown, Playwright **disconnects**. Your browser and tabs stay open.

### Privacy

- No attach logs of other tab URLs, titles, or cookies.
- No composer search, traces, or screenshots of non-bound tabs.
- No `goto` on a personal tab. Missing composer → `SELECTOR_NOT_FOUND`.

## Fallback: dedicated debug Chrome (older browsers)

If the inspect-page toggle is missing, or you want a **separate** profile with no personal tabs:

1. Close all Chrome windows (Chrome locks the default profile otherwise).
2. Start a debug Chrome:

```powershell
.\scripts\chrome-debug.ps1 -Url "https://YOUR-OWNED-CHATBOT/"
```

3. Set `BROWSER_MODE=attach` and `CDP_URL=http://127.0.0.1:9222`.

This script is optional. The API never runs it.

## Alternate: storageState file (Playwright launches its own window)

Tests and CI use this path (`BROWSER_MODE=launch`, no `CDP_URL`).

1. Set `CHATBOT_URL` and leave `CDP_URL` empty.
2. Place session JSON at `./data/storage-state.json`.
3. `HEADLESS=false` → Playwright opens its own window with those cookies.
4. `npm run smoke` then `/chat/send`.

## What you need to supply

1. A ChatGPT-like UI in the designated tab (New chat, `#prompt-textarea`, Send/Stop, `[data-message-author-role="assistant"]`)
2. Either attach (above) **or** launch + `storageState`
3. Optional: `API_KEYS` + `MAX_PAGES` (1–3)

## Out of scope forever

- Automating or scraping `chatgpt.com`
- Committing live tokens / bootstrap JSON / `.env`
- Inspecting or logging tabs you did not designate
