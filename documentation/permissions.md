# Permissions — Chatbot-to-API Bridge

No user accounts, roles, or RLS. Two principals only.

## Principals

| Principal | How identified | Scope |
|-----------|----------------|-------|
| API client | Header `x-api-key` == env `API_KEY` | POST `/chat/send`, POST `/chat/new` |
| Anyone on loopback | Unauthenticated | GET `/health` (no secrets in body) |
| Operator (human) | Filesystem access to `.env`, `data/`, `artifacts/` | Config, session file, traces |

There is no row-level data store. The “resource” is the single shared chatbot thread in the one browser page.

## Matrix

| Resource | Operation | API client (valid key) | No key | Operator |
|----------|-----------|------------------------|--------|----------|
| Chat thread | Send prompt | allow | 401 | via headed window / files |
| Chat thread | New chat + send | allow | 401 | same |
| Health JSON | Read | allow | allow | allow |
| `API_KEY` | Read | deny (not in responses) | deny | env file |
| `storageState` | Read | deny | deny | `data/` |
| Prompts | Log | deny unless `LOG_PROMPTS=true` | — | logs if enabled |

## Derivation

- API key: compared in process memory from env. Constant-time compare preferred at implementation.
- Chatbot login: not a permission of *this* API. It is a cookie jar injected at browser start.

## Enforcement

Code on Express middleware (to be written). No database policies. Bind `HOST=127.0.0.1` so “anyone” is anyone on that machine, not the internet.
