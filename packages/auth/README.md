# @homeflare/auth

D1 storage for [Better Auth](https://better-auth.com), using the official adapter.

```sh
bun add @homeflare/auth better-auth drizzle-orm @better-auth/drizzle-adapter
```

⛔ **Workers / D1 only.** This package assumes a `D1Database` binding. It does **not**
call `betterAuth()` — you do, in your own `auth.ts`.

```ts
import { createD1AuthStorage } from '@homeflare/auth';
import { betterAuth } from 'better-auth/minimal';

const { db, database } = createD1AuthStorage(env.DB, schema);

const auth = betterAuth({
  database,
  // plugins, hooks, baseURL, backgroundTasks: yours
});
```

`db` is the Drizzle client for your own queries. `database` is what Better Auth's
`database` option wants.

## Why this shape

★ The first consumer is AnyAuth, which already has a substantial issuer
(`workers/issuer/auth.ts`). Plugins, hooks, schema, request-derived `baseURL` / `rpID`,
and `ExecutionContext.waitUntil` stay there. A closed `createAuth()` factory here would
steal that control.

⛔ **Not `better-auth-cloudflare`.** That community adapter is a different stack. This
package wires `drizzle-orm/d1` to `@better-auth/drizzle-adapter` and stops. Adopting the
community wrapper was why AnyAuth refused to install `@homeflare/auth@0.1.5`.

⛔ **Server-only.** Import this from `auth.ts`, never from `auth-client.ts` or a React
file. Better Auth's plugin docs require the same split: a client bundle that pulls the
adapter also pulls the database.

⚠️ Let TypeScript infer plugin types at _your_ `betterAuth()` call. Do not wrap that
call and force-cast the result — that is how plugin types go missing
([better-auth#5047](https://github.com/better-auth/better-auth/issues/5047)). Keep
`"strict": true` (the `@homeflare/config` baseline already does).

## Which auth do you want?

| you need                                                        | use                                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| the edge already authenticated the caller; verify its assertion | [`@homeflare/cloudflare`](https://www.npmjs.com/package/@homeflare/cloudflare) — stateless, `jose` |
| **you** are the identity provider: sessions, accounts, a D1     | this package                                                                                       |

⚠️ Reaching for the wrong one produces a system that looks authenticated and is not.

★ This is a separate package for a reason: drizzle is an ORM, and a Worker that only
wants structured logging or an Access check should not resolve one.

## License

MIT © Timothy Schneider
