# @homeflare/cloudflare

Cloudflare Workers helpers: Access JWT verification and structured logging.

```sh
bun add @homeflare/cloudflare
```

⛔ **Workers only.** This package assumes workerd. For code that must also run on Node or
in a script, use [`@homeflare/kit`](https://www.npmjs.com/package/@homeflare/kit).

## verifyAccessJwt

```ts
import { verifyAccessJwt } from '@homeflare/cloudflare';

const who = await verifyAccessJwt(request, {
  teamDomain: env.TEAM_DOMAIN, // https://<team>.cloudflareaccess.com
  audience: env.POLICY_AUD, // the app's AUD tag
});
who.email; // string | undefined
who.sub; // string | undefined
who.claims; // everything else
```

⛔ **Never omit `audience`.** Any Access app in the account mints a JWT the team domain
will happily verify; the AUD tag is the only thing saying the token was minted for _this_
app.

Throws on a missing header, bad signature, wrong audience, or expiry — deliberately, so a
forgotten `if (!ok)` cannot become an open door. The JWKS is cached per isolate, so it is
not refetched per request.

## log

```ts
import { log } from '@homeflare/cloudflare';

const rlog = log.with({ requestId, path: url.pathname });
rlog.info('handled', { status, ms }); // also .debug .warn .error
```

Writes one JSON object per line, which Workers Logs indexes field by field. No logging
library: `console.log` of JSON _is_ the integration.

⚠️ One object, never `(message, fields)` — multiple arguments are stringified and
concatenated, which destroys the structure Workers Logs would index.

⛔ **Never log a credential.** There is no redaction layer, by design: a redactor implies
it is safe to pass secrets in, then quietly misses one.

## Two kinds of auth

This package verifies **Cloudflare Access** — the edge already authenticated the caller.
If _you_ are the identity provider (sessions, accounts, a database), that is
[`@homeflare/auth`](https://www.npmjs.com/package/@homeflare/auth). Reaching for the
wrong one produces a system that looks authenticated and is not.

## License

MIT © Timothy Schneider
