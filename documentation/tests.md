# Tests — verification map

## Existing coverage

| Use case | Evidence | Status |
|----------|----------|--------|
| Env boot (keys vs pages, chatgpt.com) | `tests/env.test.ts` | pass |
| Auth / validation / oversize / rate limit / queue | `tests/api.test.ts` | pass |
| Mock input-gating | `tests/mock-input.test.ts` | pass |
| Page pool bind / first-use New chat / QUEUE_FULL | `tests/page-pool.test.ts` | pass |
| E2E send, continue, new-chat clear, isolation, parallel | `tests/e2e.test.ts` | pass |
| E2E 5s stream, timeout partial, dummy SELECTOR_NOT_FOUND | `tests/e2e.test.ts` | pass |

CI: `.github/workflows/ci.yml` — `npm test` on Windows with mock.

## QA gate

```powershell
npm run typecheck
npm run smoke
npm test
.\scripts\validate.ps1
```

Headed smoke: `$env:HEADLESS='false'; npm run smoke`
Mint session against mock: `npm run login` (mock must be up)
