# @homeflare/distilled-traefik

**STUB.** This is not a generated Distilled SDK and must not be read as one.

Interim npm home for `@distilled.cloud/traefik`, which does not exist on npm
yet. The kit never pushes to `alchemy-run/distilled`. See
[`../alchemy/docs/distilled-interim.md`](../alchemy/docs/distilled-interim.md)
for the route. `src/` will be replaced by a regenerate+copy — do not
hand-grow it.

⚠️ **License.** Apache-2.0, not the kit's usual MIT — this package follows
the same redistribution terms as every other `distilled-*` interim copy.

## Intended Distilled slug

`@distilled.cloud/traefik` → alias
`"npm:@homeflare/distilled-traefik@<version>"` after publish. Kit code
never imports `@homeflare/distilled-traefik` directly.

## Auth shape

Traefik's API handler has **no authentication**. Production exposes
`api@internal` behind basicAuth / digestAuth / forwardAuth. This stub
sends an optional `Authorization` header (`fromApiBaseUrl({ authorization })`
or `TRAEFIK_API_AUTHORIZATION`). Default origin is the insecure listener
`http://127.0.0.1:8080`.

## Spec source — why this is a scaffold, not generated

Traefik documents `GET` endpoints
(`/api/version`, `/api/overview`, `/api/http/routers`, …) at
https://doc.traefik.io/traefik/reference/install-configuration/api-dashboard/
and does **not** publish an official OpenAPI document. Community OpenAPI
exists; it is not a Distilled spec source. Fetch technique for a later
convert: scrape or hand-author Smithy from those documented paths (Caddy's
`docs/provenance.md` shape), not `fetch()` of a vendor OpenAPI URL.

Experimental flags (`kubernetesGateway`, `knative`, …) are consumer Helm
values, not this client.

## What's in it

Credentials Layer + Errors + one STUB operation:
`Services.traefik.getVersion` → `GET /api/version`.

```ts
import * as Traefik from '@distilled.cloud/traefik'; // aliased onto this package after publish
import * as Effect from 'effect/Effect';

const program = Traefik.Services.traefik
  .getVersion({})
  .pipe(Effect.provide(Traefik.fromApiBaseUrl({ apiBaseUrl: 'http://127.0.0.1:8080' })));
```

## What Alchemy will need later

Read/adopt of runtime routers, services, middlewares, entrypoints
(`GET /api/http/…`, `/api/overview`). Cluster install stays an Argo
Application / Helm chart. IngressRoute CRDs can use
`@distilled.cloud/kubernetes@1.0.0-rc.12` without this package.

## Cutover

1. Publish this package (changeset).
2. Follow-up PR: alias `@distilled.cloud/traefik` in the consumer.
3. When `@distilled.cloud/traefik` exists upstream: swap the alias, delete
   this package. **STATE MUST NOT MOVE.**

## Updating it

Regenerate in a local `alchemy-run/distilled` clone (Steps 1–8 only; never
push), copy `src/` here, changeset. Until then, keep the surface minimal.

## License

Apache-2.0 (see `LICENSE`) — not the kit's usual MIT. Hand-written files
(`package.json`, `tsconfig.json`, `scripts/smoke.ts`, this README) are
offered under the same terms.
