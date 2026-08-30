# Assumptions — Chatbot-to-API Bridge

Identified with the new-product assumption set (value, usability, viability, feasibility, ethics, GTM, strategy, team). This is an internal tool, not a GTM launch, so GTM/strategy rows are thin on purpose.

Confidence: **H** high / **M** medium / **L** low.

| ID | Category | Assumption | Conf. | If wrong | Cheap test |
|----|----------|------------|-------|----------|------------|
| A1 | Feasibility | The owned chatbot DOM matches ChatGPT closely enough that mock selectors transfer | M | Cutover needs a selector pass, not a rewrite | At cutover: `discover-selectors` vs [`02-chatgpt-dom-contract.md`](./specs/02-chatgpt-dom-contract.md) |
| A2 | Feasibility | A provided Playwright `storageState` (or equivalent cookies) is enough to skip interactive login | M | Health stays not-ready; add headed login fallback | Load session against mock login; later against owned URL |
| A3 | Feasibility | Hybrid wait (stop button + text stability) detects “done” on a 3–5s stream | H | Timeouts or truncated answers | Mock `delayMs=3000` and `5000`; live one-shot at cutover |
| A4 | Feasibility | Contenteditable / ProseMirror-like composer accepts Playwright insert (`fill` or `execCommand('insertText')` / paste) | M | Send button stays disabled or sends empty | Mock uses contenteditable `#prompt-textarea`; test empty-send guard |
| A5 | Feasibility | One persistent Chromium on Windows stays stable for the process lifetime | M | Relaunch path is the safety net | Crash injection test |
| A6 | Value | A non-streaming JSON reply is enough for callers | H | P1 SSE | Owner confirmed no streaming in v1 |
| A7 | Value | Single shared API key is enough protection | M | localhost bind limits blast radius | Never expose port publicly in v1 |
| A8 | Usability | Operators can switch headed/headless via env without other changes | H | Document `HEADLESS` | Config review |
| A9 | Usability | Callers will check `partial: true` on timeouts | M | They may treat 504 as empty | README + field on every TIMEOUT body |
| A10 | Viability | Queue of 10 and 3–5s generations are enough load | H | `QUEUE_FULL` is the backpressure | Owner: low-stakes bot |
| A11 | Ethics | We automate only a UI the owner owns | H | Do not point `CHATBOT_URL` at chatgpt.com | Hard non-goal in plan |
| A12 | Ethics | Prompts may be sensitive; default is do not log them | H | Leak in pino logs | `LOG_PROMPTS=false` default |
| A13 | GTM | N/A — not a marketed product | — | — | — |
| A14 | Strategy | Mock-first then URL swap is faster than waiting for the real URL | H | If clone ≠ ChatGPT, extra selector work | DOM contract freeze |
| A15 | Team | One lead agent + owner checkpoint at cutover is enough | H | — | Nawab §13 human gates |

**Hottest tests before cutover:** A1, A2, A4.
