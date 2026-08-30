# Tests — verification map

Honest map: **no application tests exist yet** (documentation-only phase). Everything below is **proposed** until Phase A+ lands code.

## Existing coverage

| Use case | Rule | Expected | Evidence | Status |
|----------|------|----------|----------|--------|
| — | — | — | Repo has no `src/` or `tests/` | **none** |

CI-required: not defined until `package.json` exists.

## Proposed tests (implementation)

| Use case | Rule | Expected (incl. deny) | Type | Pins |
|----------|------|------------------------|------|------|
| Health | Open, no secrets | 200; no `API_KEY` in body | automated API | F4 |
| Send without key | Authz | 401 `UNAUTHORIZED` | automated API | permissions |
| Wrong key | Authz | 401 | automated API | permissions |
| Empty / huge prompt | Validation | 400 `VALIDATION_ERROR` | automated API | variables |
| Send on mock | Assistant ≠ user echo | 200 `partial: false` | E2E Playwright + mock | F1, DOM contract |
| New chat | Button clears thread | 200, history reset | E2E | F2 |
| 3s stream | Completes in budget | 200, full canned text | E2E `delayMs=3000` | KR3 |
| 5s stream | Completes in 12s budget | 200 | E2E `delayMs=5000` | KR3 |
| Over-budget stream | Partial flagged | 504, `partial: true`, `response` non-empty | E2E `delayMs=20000` | F3 |
| Queue overflow | Cap | 429 `QUEUE_FULL` | API + delayed mock | §6 queue |
| Missing composer | Selectors | 502 `SELECTOR_NOT_FOUND`, process up | E2E dummy page | recover |
| Contenteditable insert | Send enables only on input | Naive innerHTML does not send; automation path does | mock unit + E2E | A4 |
| Crash | Relaunch | Next request works or 503 then recover | E2E | F6 |
| Session file | Boot chat-ready | Mock login → storageState → headed/headless both | E2E | F5 |

## Gaps (until proposed tests are written)

Every PRD rule is unverified. Highest exposure: sending the user echo as `response`; empty ProseMirror send; timeout without `partial: true`.

**After code exists:** this file must be rewritten so “Existing coverage” lists real test names. Do not leave proposed rows marked as green.
