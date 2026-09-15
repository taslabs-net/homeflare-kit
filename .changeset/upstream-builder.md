---
'@homeflare/kit': minor
---

Add `upstream()` and `writableUpstream()` — a client for one API, carrying that API's
quirks so no caller re-derives them.

ky stays the transport; this adds only what ky has no opinion about:

- **Fails closed on a missing credential**, and distinguishes the two ways it happens: an
  empty value means the secret did not render, `"null"` means the binding name is wrong.
  Omitting the header instead produces a bare 401, which reads as a bad credential and
  sends an operator to rotate a good secret.
- **Never follows a redirect.** An unauthenticated request is often answered with a 302 to
  a login page; following it returns HTML with status 200, which reads as a broken API.
- **Per-upstream auth schemes.** Django REST Framework wants `Token <value>`; Bearer
  returns 401 there, and a wrong scheme is indistinguishable from a wrong credential.
- **Reads and writes are separate functions.** `upstream()` exposes GET only. Writes need
  `writableUpstream()`, so widening is a visible choice rather than a flag.

```ts
const grafana = upstream({
  system: 'grafana',
  urlVar: 'GRAFANA_URL',
  defaultUrl: 'http://127.0.0.1:3000',
  tokenVar: 'GRAFANA_TOKEN',
  pathPrefix: '/api',
});

await grafana.get('/dashboards').json<Dashboard[]>();
```
