# Cutover notes (Phase H)

**Status: blocked** until the owner provides:

1. Owned chatbot URL (not `chatgpt.com`)
2. Playwright `storageState` JSON (or run `npm run login` against a clone that supports the mock login shape)

## Steps when ready

1. Set `CHATBOT_URL` to the owned clone.
2. Place session file at `STORAGE_STATE_PATH` (default `./data/storage-state.json`).
3. Verify selectors in `docs/specs/02-chatgpt-dom-contract.md` still match (especially `create-new-chat-button`, `#prompt-textarea`, send/stop).
4. `npm run smoke` then curl `/health`, `/chat/send`, `/chat/new`.
5. Keep `HEADLESS=true` or `false` as needed; do not commit `.env` or session files.

## Out of scope forever

- Automating or scraping `chatgpt.com`
- Committing live tokens / bootstrap JSON
