# Automation — Chatbot-to-API Bridge

This product **is** the automation. There is no inner LLM SDK. Playwright is the tool surface.

## Agent / job

| Field | Value |
|-------|--------|
| Name | Chat send/new (in-process queue worker) |
| Trigger | HTTP POST (not a cron, not a webhook from a vendor) |
| Owner | This service |
| Runs | Automatically after API key + validation + queue slot |
| Approval | None beyond the API key (v1) |

## Inputs it may read

- Request `prompt`, optional `sessionId`
- Env config (timeouts, URL, HEADLESS)
- DOM of `CHATBOT_URL` (mock or owned clone)
- `storageState` cookies at boot only

## Tools it may call (hard guardrail)

| Tool | Allowed | Forbidden |
|------|---------|-----------|
| Playwright on `CHATBOT_URL` | yes | any other origin, including chatgpt.com |
| Filesystem `artifacts/` | yes, on error | writing secrets into git |
| Network besides the chat origin | no extra APIs | OpenAI/Anthropic HTTP APIs |

## Steering vs guardrails

- **Steering:** none (no prompt-to-the-model in *this* process; the owned bot has its own system prompt).
- **Hard guardrails:** API key, prompt length, queue cap, generation timeout, selector allow-list, localhost bind, `LOG_PROMPTS=false`.

## Output contract

JSON as in the engineering spec: `response`, `partial`, `sessionId`, `durationMs`, `requestId`. Timeout still returns `response` with `partial: true`.

Failure: coded errors, no stack traces to the client. Recover before the next job.

## Side effects

- **App-owned:** HTTP response, logs, optional traces.
- **UI-owned:** messages appear in the chatbot thread (the whole point).
- Kill switch: stop the Node process; queue dies with it. No drain protocol in v1 beyond SIGTERM closing the browser.
