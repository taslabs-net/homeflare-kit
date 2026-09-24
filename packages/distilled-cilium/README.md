# @homeflare/distilled-cilium

**STUB.** This is not a generated Distilled SDK and must not be read as one.

Interim npm home for `@distilled.cloud/cilium`, which does not exist on npm
yet. The kit never pushes to `alchemy-run/distilled`. See
[`../alchemy/docs/distilled-interim.md`](../alchemy/docs/distilled-interim.md)
for the route. `src/` will be replaced by a regenerate+copy — do not
hand-grow it.

⚠️ **License.** Apache-2.0, not the kit's usual MIT — this package follows
the same redistribution terms as every other `distilled-*` interim copy.

## Intended Distilled slug

`@distilled.cloud/cilium` → alias
`"npm:@homeflare/distilled-cilium@<version>"` after publish. Kit code never
imports `@homeflare/distilled-cilium` directly.

## Auth shape

The cilium-agent API is a **unix-socket JSON API with no HTTP auth**
(`x-schemes: [unix]`, typically `/var/run/cilium/cilium.sock`). This
package never dials the socket — the caller's `HttpClient` does, same as
Caddy. Default `apiBaseUrl` is `http://localhost` as a TCP stand-in.

## Spec source — why this is still a scaffold

Cilium **does** publish a usable official spec:

- https://github.com/cilium/cilium/blob/main/api/v1/openapi.yaml
- raw fetch (never clone the repo):
  `https://raw.githubusercontent.com/cilium/cilium/main/api/v1/openapi.yaml`
- docs: https://docs.cilium.io/en/stable/api/
- swagger 2.0, `basePath: /v1`, tag `daemon` for `/healthz`

That is a Distilled **A** candidate (`spec-repos/github` / `turso` technique:
`raw.githubusercontent.com` per file). This PR ships **B** so Alchemy can
import a published name before a full generate+copy lands. The next
regenerate in a local distilled clone should consume that file and replace
`src/` verbatim.

Cilium BGP is a consumer Helm / CRD concern, not this client.

## What's in it

Credentials Layer + Errors + one STUB operation:
`Services.daemon.getHealthz` → `GET /v1/healthz`.

```ts
import * as Cilium from '@distilled.cloud/cilium'; // aliased onto this package after publish
import * as Effect from 'effect/Effect';

const program = Cilium.Services.daemon
  .getHealthz({})
  .pipe(Effect.provide(Cilium.fromApiBaseUrl({ apiBaseUrl: 'http://localhost' })));
```

## What Alchemy will need later

Agent health/config (`/v1/healthz`, `/v1/config`), endpoints, policy.
Cluster-wide CiliumNetworkPolicy / CiliumBGP* objects are Kubernetes CRDs
and can use `@distilled.cloud/kubernetes@1.0.0-rc.12`. CNI install stays
an Argo Application / Helm chart.

## Cutover

1. Publish this package (changeset).
2. Follow-up PR: alias `@distilled.cloud/cilium` in the consumer.
3. Prefer: generate from the official OpenAPI in a local distilled clone,
   copy `src/` here, then alias.
4. When `@distilled.cloud/cilium` exists upstream: swap the alias, delete
   this package. **STATE MUST NOT MOVE.**

## Updating it

In a local `alchemy-run/distilled` clone — Steps 1–8 only, ⛔ never push:

```sh
# fetch-specs.ts: raw.githubusercontent.com cilium/cilium api/v1/openapi.yaml
DISTILLED_SPECS_LOCAL=1 pnpm generate cilium
pnpm --filter @distilled.cloud/cilium run typecheck
pnpm format && pnpm specs:check
```

Then copy `src/` here and changeset.

## License

Apache-2.0 (see `LICENSE`) — not the kit's usual MIT. Hand-written files
(`package.json`, `tsconfig.json`, `scripts/smoke.ts`, this README) are
offered under the same terms.
