# Access for a surface that is not a Worker — `@homeflare/cloudflare/access-auth`

Cloudflare Access authenticates the caller at the edge and forwards a signed JWT. A Worker
reads the identity from `ctx.access` and is done. **Anything else — a daemon on a host, a
web UI behind a tunnel — has to verify that JWT itself**, and that is what this is: a
`forward_auth` verifier a reverse proxy calls before it lets a request reach the upstream.

```
browser ─► Cloudflare Access ─► tunnel ─► Caddy ─┬─► verifier  (this package)
                                                 └─► upstream  (only on 2xx)
```

## The trap: verifying the wrong AUD admits everyone

⛔ **Every Access application in one account is signed by the same team keys.** A token
minted for a different app of yours has a valid signature, a valid `iss`, and an unexpired
`exp`. The `aud` claim is the _only_ thing that says the token was minted for **this**
application.

A verifier that checks the issuer and skips the audience therefore admits **every Access
user of every app you run**. It does not look broken: you log in, it works, your colleagues
log in, it works. It fails the day someone who was only ever given the staging dashboard
opens the thing you thought was locked.

So `audience` is required, it is fixed when the handler is constructed, and it is never read
from the request. One handler per Access application — two apps mean two handlers.

## Running it

```ts
import { accessForwardAuth } from '@homeflare/cloudflare/access-auth';

const verify = accessForwardAuth({
  teamDomain: 'https://example.cloudflareaccess.com', // no trailing slash
  audience: process.env['ACCESS_AUD'] ?? '', // the app's AUD tag
});

Bun.serve({ hostname: '127.0.0.1', port: 9101, fetch: verify });
```

It is a plain `(Request) => Promise<Response>`, so Node's fetch adapters and workerd take it
unchanged. Answers:

| outcome                                             | status | upstream sees                    |
| --------------------------------------------------- | ------ | -------------------------------- |
| verified                                            | 204    | `X-Access-Email`, `X-Access-Sub` |
| no token, bad signature, wrong `aud`/`iss`, expired | 401    | nothing — request stops          |
| verified but refused by your `authorize`            | 403    | nothing — request stops          |
| the team's JWKS endpoint is down                    | 401    | nothing — **fails closed**       |

The refusal carries no body and no reason: an unauthenticated caller learns nothing. The
reason goes to the log as a fixed enum (`no-token`, `invalid-token`, `jwks-unavailable`,
`not-authorized`, `unexpected`) — `jwks-unavailable` is the one worth alerting on, because
it is the only one that means _your_ system is broken rather than the caller's token.

⛔ **The token is never logged**, at any level, whole or truncated. A logged token is a
replayable session for the whole of its `exp`.

## Wiring it into Caddy

`@homeflare/alchemy/caddy` renders the block, so the fields that matter are not retyped:

```ts
import { accessForwardAuth as forwardAuth, caddyWithFile } from '@homeflare/alchemy/caddy';

const caddyfile = `vnc.example.com {
${forwardAuth({ verifier: '127.0.0.1:9101', body: ['reverse_proxy 127.0.0.1:6080'] })}
}
`;
```

which produces:

```caddyfile
vnc.example.com {
	reverse_proxy 127.0.0.1:6080
	forward_auth 127.0.0.1:9101 {
		uri /access/verify
		copy_headers {
			X-Access-Email
			X-Access-Sub
		}
	}
}
```

### Why `copy_headers` is the security-critical line

Caddy's `forward_auth` copies the listed headers **from the verifier's response onto the
client's request**, then passes it upstream. It expands to roughly:

```caddyfile
@good status 2xx
handle_response @good {
	request_header X-Access-Email {rp.header.X-Access-Email}
}
```

⚠️ **A client can send `X-Access-Email: admin@example.com` itself.** It is overwritten only
because the verifier's 204 carries that header. Caddy's documentation does not promise what
happens to a listed field the auth response omits — so this verifier **always emits every
identity header on a 2xx, empty string included**, rather than depending on that. A token
with no `email` claim yields `X-Access-Email: ` and the client's value is gone either way.

★ The corollary: **the list in `copy_headers` and the headers the verifier sets must agree.**
A header the verifier sets but Caddy does not copy never arrives. A header Caddy copies but
the verifier never sets is the spoofing case above. `accessForwardAuth()` defaults both ends
to the same two names for exactly that reason; if you rename them, rename them on both sides.

### Bind everything to loopback

⛔ **Verifying the JWT is worth nothing if the upstream is reachable directly.** The check
lives in Caddy's request path; anything that can reach the upstream's port skips it entirely.
Both the verifier and the upstream bind to `127.0.0.1`, and Caddy is the only way in.
`accessForwardAuth()` refuses a verifier address that is not loopback or a unix socket — not
because a routable verifier cannot work, but because one is almost always an accident.

## Key rotation, caching and outages

The JWKS is fetched once per team domain and reused; jose refetches when it meets an unknown
`kid`, which is how a rotated-in key is picked up without a restart. A certs endpoint that is
_down_ is latched open for 30s by the breaker in `jwks-breaker.ts` — without it, jose refetches
on every verification while the endpoint is failing, turning every inbound request into an
outbound one.

⚠️ **An unknown `kid` is a bad token, not an outage.** A key the endpoint does not publish
means a forgery or a long-rotated token, and it is classified as `invalid-token`. Filing it
under `jwks-unavailable` would hide a forged token inside the alert that says Cloudflare is
having a bad day.

## What this does not do

- **It does not replace the Access policy.** Access decides who may authenticate; this
  decides that the caller actually did. Use `authorize` for an extra rule, not as the gate.
- **It does not help a Worker.** Behind Access, a Worker has `ctx.access.getIdentity()` and
  should use it — see `accessIdentity` in the package entry.
- **It does not terminate anything.** If the protected surface speaks a protocol Caddy is
  proxying as raw TCP, there is no HTTP request to carry a JWT and no place for this to run;
  the surface needs an HTTP front (a websockify, a web UI) before Access can guard it.
