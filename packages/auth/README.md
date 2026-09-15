# @homeflare/auth

[Better Auth](https://better-auth.com) with the Cloudflare adapter.

> ⚠️ **Scaffold. Not ready for adoption.** This package currently exports only `VERSION`.
> The dependencies resolve and the install is clean, but there is no API yet — the shape
> should be decided by the first app that needs one, not guessed here.

```sh
bun add @homeflare/auth
```

Dependencies: `better-auth` · `better-auth-cloudflare`, which pulls `drizzle-orm`.
Peers you must provide: `@better-auth/drizzle-adapter` ^1.5.0 ·
`@cloudflare/workers-types` >=4.

## Which auth do you want?

| you need                                                          | use                                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| the edge already authenticated the caller; verify its assertion   | [`@homeflare/cloudflare`](https://www.npmjs.com/package/@homeflare/cloudflare) — stateless, `jose` |
| **you** are the identity provider: sessions, accounts, a database | this package                                                                                       |

⚠️ Reaching for the wrong one produces a system that looks authenticated and is not.

★ This is a separate package for a reason: `better-auth-cloudflare` pulls an ORM, and a
Worker that only wants structured logging or an Access check should not resolve one.

## License

MIT © Timothy Schneider
