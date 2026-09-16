---
'@homeflare/auth': minor
'@homeflare/config': minor
---

Ship the Workers/D1 Better Auth primitive, and an app tsconfig for source-publishing deps.

An app team could not adopt `@homeflare/auth@0.1.5`: it exported only `VERSION` and
depended on `better-auth-cloudflare`, which takes over plugins, hooks, schema, baseURL
and background tasks. They already used official `better-auth/minimal` plus
`@better-auth/drizzle-adapter`.

**`createWorkersAuth`** binds D1 through that official adapter and `waitUntil` through
Better Auth's own `advanced.backgroundTasks.handler`. Everything else stays on the
options the app passed. `better-auth-cloudflare` is gone.

**`tsconfig.app.json`** extends the strict baseline and turns off
`exactOptionalPropertyTypes`, `noImplicitOverride` and `noUncheckedIndexedAccess`.
`skipLibCheck` cannot help: `@cloudflare/ci@0.2.0` and Better Auth plugins publish
`.ts`, so those flags fail the consumer. Owned packages still extend `base` / `lib`.
