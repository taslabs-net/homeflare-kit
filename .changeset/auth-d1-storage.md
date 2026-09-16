---
'@homeflare/auth': minor
'@homeflare/config': minor
---

Ship `createD1AuthStorage` — D1 + schema in, `{ db, database }` out — and an app
tsconfig for source-publishing deps.

AnyAuth is the first consumer. It already runs official `better-auth` with
`@better-auth/drizzle-adapter` on D1, and it blocked on `@homeflare/auth@0.1.5` because
that tarball depended on `better-auth-cloudflare` and exported only `VERSION`.

⛔ This is a storage primitive, not a `createAuth()` factory. Plugins, hooks, schema,
request-derived base URL, and `ExecutionContext` background tasks stay in the app.
Wrapping `betterAuth()` here would freeze the wrong shape and erase plugin inference
(better-auth#5047).

⛔ `better-auth-cloudflare` is gone. It is a community wrapper (zpg6), not Cloudflare.
The wiring is `drizzle-orm/d1` + `@better-auth/drizzle-adapter`, which AnyAuth already
uses. Server-only: import from `auth.ts`, never from `auth-client.ts`.

**`tsconfig.app.json`** extends the strict baseline and turns off
`exactOptionalPropertyTypes`, `noImplicitOverride` and `noUncheckedIndexedAccess`.
`skipLibCheck` cannot help: `@cloudflare/ci@0.2.0` and Better Auth plugins publish
`.ts`, so those flags fail the consumer. Owned packages still extend `base` / `lib`.
