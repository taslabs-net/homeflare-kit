# @homeflare/cloudflare

Cloudflare Workers helpers: Access JWT verification and structured logging.

```sh
bun add @homeflare/cloudflare
```

⛔ **Workers only.** This package assumes workerd. For code that must also run on Node or
in a script, use [`@homeflare/kit`](https://www.npmjs.com/package/@homeflare/kit).

## Which auth path?

Three, and they are **not alternatives** — pick by where your code runs:

| your code                      | use                        | why                                                                                |
| ------------------------------ | -------------------------- | ---------------------------------------------------------------------------------- |
| a Worker **behind** Access     | `accessIdentity(ctx)`      | the edge already enforced the policy and attached the identity — no token handling |
| an origin with no `ctx.access` | `verifyAccessJwt(request)` | service-to-service, a non-Worker origin, or a Worker reached by service binding    |
| an **MCP server**              | `serveMcpMetadata()`       | neither of the above lets a client _discover_ how to authenticate                  |

## accessIdentity — Workers behind Access

```ts
import { accessIdentity } from '@homeflare/cloudflare';

export default {
  async fetch(request, env, ctx) {
    const who = await accessIdentity(ctx);
    if (who === undefined) return new Response('Access did not run', { status: 401 });

    return Response.json({ email: who.email, groups: who.groups });
  },
};
```

★ **Prefer this when it applies.** Cloudflare attaches the identity to the execution
context (shipped 2026-08-14); verifying the assertion yourself re-checks something the
platform already enforced.

⛔ Returns `undefined` rather than throwing, unlike `verifyAccessJwt` — a Worker may
legitimately serve open routes too, so "no Access here" is a branch you decide, visible at
the call site.

⚠️ **`ctx.access` does not propagate through service bindings or RPC.** A downstream Worker
reached by binding sees `undefined` even though the caller was authenticated. It needs its
own Access application, or to be told.

⚠️ **Read groups from here, not from a token.** Cloudflare trims the JWT's `custom` claim
at roughly 1 KB — silently — so group membership read from an assertion can be incomplete.
That is an authorization bug that only shows up for users in many groups.

## serveMcpMetadata — RFC 9728 for MCP servers

```ts
import { serveMcpMetadata, unauthorizedResponse } from '@homeflare/cloudflare';

const auth = {
  resource: 'https://mcp.example.com/mcp',
  authorizationServer: 'https://team.cloudflareaccess.com',
};

export default {
  async fetch(request, env, ctx) {
    const discovery = serveMcpMetadata(request, auth);
    if (discovery !== undefined) return discovery;

    const who = await accessIdentity(ctx);
    if (who === undefined) return unauthorizedResponse(auth);
    // …serve MCP
  },
};
```

⛔ **Both halves, or neither works.** The MCP spec requires a server to publish Protected
Resource Metadata _and_ a 401 to carry `WWW-Authenticate` naming it. Publishing the
document while answering a bare 401 leaves clients that follow the header — the common
path — with nowhere to go.

⚠️ The well-known URL is **derived** from the resource URL, not chosen. That derivation is
a security property: it stops anyone publishing metadata claiming to describe a resource
they have no authority over.

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
