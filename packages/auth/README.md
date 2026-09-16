# @homeflare/auth

[Better Auth](https://better-auth.com) on Workers/D1, via the official drizzle adapter.

```sh
bun add @homeflare/auth
```

```ts
import { createWorkersAuth } from '@homeflare/auth';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export default {
  async fetch(request, env, ctx) {
    const auth = createWorkersAuth({
      db: drizzle(env.DB, { schema }),
      schema,
      waitUntil: ctx.waitUntil,
      secret: env.BETTER_AUTH_SECRET,
      request, // or pass official baseURL / { allowedHosts } yourself
      plugins: [], // the app's — organization, two-factor, whatever you own
    });
    return auth.handler(request);
  },
};
```

⛔ **This does not take over your auth.** `createWorkersAuth` binds D1 through
`@better-auth/drizzle-adapter` and `waitUntil` through Better Auth's own
`advanced.backgroundTasks.handler`. Plugins, hooks, schema, social providers and
request-derived `baseURL` stay on the options you pass.

⚠️ Import `better-auth/minimal`, not `better-auth`. The full entry pulls Kysely even
when you never use it.

## Which auth do you want?

| you need                                                          | use                                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| the edge already authenticated the caller; verify its assertion   | [`@homeflare/cloudflare`](https://www.npmjs.com/package/@homeflare/cloudflare) — stateless, `jose` |
| **you** are the identity provider: sessions, accounts, a database | this package                                                                                       |

⚠️ Reaching for the wrong one produces a system that looks authenticated and is not.

★ This is a separate package so a Worker that only wants logging or an Access check
does not resolve an ORM.

## License

MIT © Timothy Schneider
