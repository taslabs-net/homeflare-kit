# Grafana — `@homeflare/alchemy/grafana`

`Grafana.Datasource` declares one Grafana data source, keyed by `uid`. Every call goes through
`@distilled.cloud/grafana@1.0.0-rc.12`'s typed operations, `catchTag('NotFound', ...)` in place of
any status check. Built 2026-09-24 against the live target `teslamate-grafana.service` on CT100 —
measured version **13.1.3** (`teslamate/grafana:4.2.0`), listening on `127.0.0.1:3100`, served
publicly at `tesla.homeflare.dev/dash/`.

## The SDK gap — why only `Datasource` ships

Measured 2026-09-24 against the published `@distilled.cloud/grafana@1.0.0-rc.12` tarball (its
`lib/services/grafana.d.ts`, 4,938 lines): the package has **no create/read/update/delete
operations for folders, dashboards, alert rules or contact points**. It covers datasources in
full (`addDataSource`, `getDataSourceByUID`, `updateDataSourceByUID`, `deleteDataSourceByUID`,
`getDataSources`), plus org/user/team/role/report/annotation/library-element/public-dashboard/
snapshot management — but:

- **Folders:** only `updateFolderPermissions` exists. No `createFolder`, `getFolder` or
  `deleteFolder` — Grafana's `/api/folders` and `/api/folders/{uid}` routes are entirely absent.
- **Dashboards:** only snapshot and public-dashboard routes exist (`createDashboardSnapshot`,
  `getPublicDashboard`, …). No `POST /api/dashboards/db`, no `GET /api/dashboards/uid/{uid}`, no
  `DELETE /api/dashboards/uid/{uid}` — the plain dashboard CRUD route family is absent.
- **Alert rules:** only `routeGetAlertRuleExport`/`routeGetAlertRuleGroupExport`/
  `routeGetAlertRulesExport` exist — export (read-only) endpoints under `/api/v1/provisioning/`.
  No create/update/delete for `/api/v1/provisioning/alert-rules{,/{uid}}`.
- **Contact points:** only `routeGetContactpointsExport` exists, same story — no
  `/api/v1/provisioning/contact-points{,/{uid}}` CRUD.

This is recorded in [`docs/upstream-conformance.md`](./upstream-conformance.md) rather than worked
around. Per S23, the fix is a distilled PR (regenerate against a spec that includes these routes,
or patch them in per S22), not a hand-rolled `HttpClient` client in this package for the missing
pieces alone — that would put half a family through the SDK and half through a second, parallel
client, exactly what S23 exists to prevent.

`teslamate-grafana` itself is consistent with this gap being real, not merely unexploited: its one
datasource is API-manageable and already exists; its dashboards ship baked into the
`teslamate/grafana` image and are provisioned by the container, not by any API call; it has no
folders, alert rules or contact points configured at all (measured over ssh, read-only, 2026-09-24).

## Credentials

A `GrafanaTarget` — an instance origin plus a token env var NAME, never a literal value (S25):

```ts
import { grafanaProviders } from '@homeflare/alchemy/grafana';

const teslamateGrafana = grafanaProviders({
  baseUrl: 'https://tesla.homeflare.dev/dash',
  tokenEnv: 'TESLAMATE_GRAFANA_TOKEN',
});
```

`tokenEnv` is read fresh from `process.env` inside each operation's own effect (S24) — a layer
built once still re-reads the environment on every request. This house wrapper exists because,
unlike Forgejo (one instance for this estate), Grafana is not: `grafana.homeflare.dev` and
`teslamate-grafana` are two instances with two different tokens, and the unit file for the latter
says explicitly it uses "Own Access SaaS OIDC client, never grafana.homeflare.dev's" — one global
`GRAFANA_TOKEN`/`GRAFANA_URL` pair (the SDK's own `CredentialsFromEnv`) cannot address both. A
stack declaring resources against both instances calls `grafanaProviders` twice, once per target;
the `Grafana.Datasource` resource type itself is one global registration shared by both calls.

A datasource's `secureJsonData` (e.g. its password) follows the same rule: `secureJsonDataRefs`
takes a map of field name to env var NAME, resolved the same way, never returned in `attributes` —
Grafana's own read API agrees, since `DataSource.secureJsonFields` on a GET is a map of booleans
(is-it-set), never the value.

## Adopt semantics

`reconcile` observes before it writes (S9/S10): a `uid` the target instance already has is bound,
and when the declaration already matches what's live, nothing is sent — no create, no update.
Declaring exactly what's live changes nothing. This is why `uid` is a **required** prop rather than
generated: `getDataSourceByUID`/`updateDataSourceByUID`/`deleteDataSourceByUID` are all UID-keyed,
and `getDataSources` (list) takes no filter, so locating an object this resource didn't create
would mean listing the whole org and matching by name — the same ambiguity
`netbox/resource.ts`'s `soleMatch` exists to catch. Requiring `uid` up front (Grafana accepts a
caller-chosen one on create) sidesteps it: every operation keys on the one field the API itself is
keyed on.

## Example

```ts
import { GrafanaDatasource, grafanaProviders } from '@homeflare/alchemy/grafana';

export class TeslaMateDatasource extends GrafanaDatasource('teslamate-datasource', {
  uid: '<the live uid — see the census handoff>',
  name: 'TeslaMate',
  type: 'postgres',
  access: 'proxy',
  isDefault: true,
}) {}
```

```ts
// …then provide `grafanaProviders({ baseUrl, tokenEnv })` alongside the stack's other providers.
```

## Not covered

- **Folders, dashboards, alert rules, contact points.** Blocked on the SDK gap above — a
  maintainer decision on whether to patch distilled or wait for upstream to add the routes.
- **`read` never answers `Unowned`** — the same open gap forgejo's and netbox's own families
  still carry (see upstream-conformance.md); a maintainer decision on the ownership-check shape.
