# `Grafana.Folder` and `Grafana.Dashboard` — `@homeflare/alchemy/grafana`

Built 2026-09-24 on the same `@distilled.cloud/grafana` (aliased onto
`@homeflare/distilled-grafana@0.2.0`) operations that fixed the SDK gap
[grafana.md](./grafana.md#the-sdk-gap--history-and-what-shipped-on-top-of-the-fix) recorded:
`createFolder`/`getFolderByUID`/`updateFolder`/`deleteFolder`/`getFolders` and
`postDashboard`/`getDashboard`/`deleteDashboard`, plus a typed `PreconditionFailed` (412) for
dashboard version conflicts. No live call was made writing this PR — see "Measured vs inferred"
below for exactly which claims that limits.

## Both follow `Grafana.Datasource`'s doctrine

Same file shape (`resource.ts`'s shared `GrafanaSpec`/`grafanaOperations`/`grafanaHandlers`), same
credentials layer (`grafanaProviders(target)`), same **uid required, never generated** reasoning —
`getFolderByUID`/`updateFolder`/`deleteFolder` and `getDashboard`/`postDashboard`/`deleteDashboard`
are all UID-keyed, and neither `getFolders` nor a dashboard list endpoint takes a per-uid filter,
so locating an object this resource didn't create would mean listing everything and matching by
name — the ambiguity requiring `uid` up front sidesteps.

## `Grafana.Folder`

```ts
import { GrafanaFolder, grafanaProviders } from '@homeflare/alchemy/grafana';

export class Infra extends GrafanaFolder('infra-folder', {
  uid: 'infra',
  title: 'Infrastructure',
}) {}
```

- **`description` is write-only** — MEASURED against the SDK's generated types: `Folder` (the GET
  response) has no `description` field at all, though `CreateFolderRequest`/`UpdateFolderRequest`
  both accept one. Sent on every create/update that declares it; never compared, the same
  treatment `Grafana.Datasource` gives `secureJsonDataRefs` for the same reason (nothing to diff
  against).
- **Nesting (`parentUid`) is create-only** — MEASURED: `UpdateFolderRequest` has no `parentUid`
  field (`folder_uid`, `description`, `overwrite`, `title`, `version` only). A declaration whose
  `parentUid` no longer matches the live folder REFUSES with `GrafanaFolderReparentError` rather
  than silently doing nothing or deleting-and-recreating under the new parent (which — next
  bullet — takes every dashboard and alert rule in the folder with it). Move a folder by hand in
  Grafana, then update the declaration.
- **Delete defaults to `retain`** — `deleteFolder`'s own operation description says it deletes
  "all dashboards (and their alerts) stored in the folder... cannot be reverted... also deletes
  all the subfolders." That is the multi-object cascade `openbao/mount.ts` guards with
  `defaultRemovalPolicy: 'retain'`, verified there against Alchemy's own `Apply.ts` (not
  re-verified here; same engine, same option — see `folder.ts`'s header). A stack that wants the
  cascade opts in with `.pipe(RemovalPolicy.destroy())`; `destroy` still implements the real
  `DELETE` in full either way (S11). `Grafana.Dashboard` does **not** default to retain — see its
  own section below.

## `Grafana.Dashboard`

```ts
import { GrafanaDashboard, grafanaProviders } from '@homeflare/alchemy/grafana';

export class FleetOverview extends GrafanaDashboard('fleet-overview-dashboard', {
  uid: 'fleet-overview',
  folderUid: 'infra',
  dashboard: {
    title: 'Fleet Overview',
    panels: [/* … exported straight from Grafana's own "Export as JSON" … */],
  },
}) {}
```

- **The declared content is the dashboard JSON model** — the same shape Grafana's own "Export as
  JSON" produces. `dashboard-model.ts`'s `normalizeModel` strips `id`/`version`/`iteration`
  (Grafana-managed, injected/incremented on every save) and forces `uid` to this resource's own
  value regardless of where — or whether — the source model carried one, before ANY comparison.
  That is what makes a pasted export (which always embeds the OLD live uid) and a freshly-read
  live model compare equal, and what makes a no-change plan a true noop despite those fields
  moving on every live save.
- **Array order is significant, and nothing here needs a `sortedSet`** — `panels` (screen layout
  via its own `gridPos`, but the array order also drives Grafana's internal panel indexing and
  `repeat` behavior) and each panel's `targets` (query execution/legend order) are compared
  positionally, never reordered. Nothing in a dashboard model is a genuinely unordered SET the way
  UniFi's `trustedDhcpServerIpAddresses` is (`unifi/network-form.ts`'s `sortedSet`) — this family
  has no field that needs one. `schemaVersion` is deliberately left comparing as-is — NOT MEASURED
  whether Grafana rewrites it on a plain save, so normalizing it away on a guess risked hiding a
  genuine schema mismatch instead of a false diff; see `dashboard-model.ts` for the exact reasoning
  and what evidence would justify adding it to the volatile-field list.
- **`matches` compares "is the declaration a subset of what is live", not plain equality** —
  `dashboard-model.ts`'s `declaredContentMatches`, added after an adversarial review of this PR
  found plain structural equality (`alchemy/Diff`'s `deepEqual`, used in an earlier version of this
  PR) made an ordinary, never-edited dashboard show `update` FOREVER: Grafana's own schema
  migration on save decorates any panel or target whose `datasource` is absent with an explicit
  `{type, uid}` reference — documented Grafana behavior, not re-measured against a live instance in
  this PR. A declared panel that never sets `datasource` therefore read back with that field
  populated, disagreed with the declaration, got written back undecorated, and got redecorated
  again — non-convergent. `declaredContentMatches` instead asks only whether every field the
  DECLARATION mentions, at any depth, still matches what is live; `live` may carry additional
  fields Grafana injected that the declaration never mentioned. Real content drift (a field the
  declaration DOES mention changing, or vanishing) is still caught exactly as before. The
  trade-off, deliberate: **removing** a field from the declaration can no longer force Grafana to
  drop a value it — or a previous declaration — set; only an explicit replacement value changes
  one. This is the same "undeclared means don't care, never means force-to-default" convention this
  whole kit already uses for a plain optional prop, now applied inside the JSON model too.
- **412 version conflicts fail loudly, never overwritten blindly.** `update` injects the version
  this resource just read (from the same `fetchLive` call `reconcile` already made) into the model
  it sends, and `overwrite` is never set. If Grafana's own check still fails — someone saved in the
  gap between that read and this write — `PreconditionFailed` is left uncaught: the whole reconcile
  fails and nothing is written. The next `plan`/`deploy` re-reads the new live version fresh; there
  is no separate retry loop in this file, because that next run already is the re-read.
- **No retain default**, unlike `Grafana.Folder`. Deleting one dashboard is a single-object blast
  radius — the same class `Grafana.Datasource` already accepts without a retain guard, not
  `Grafana.Folder`'s multi-object cascade.

## Provisioned objects — refused for writes, adoption is fine

A folder or dashboard that a provisioning FILE manages (rather than this API) carries a live
signal — `Folder.managedBy` (non-empty) and `DashboardMeta.provisioned`/`provisionedExternalId` —
that `update`/`destroy` check before ever calling the SDK; `GrafanaProvisionedObjectError` names
the owning file when Grafana reports one (dashboards only — a folder's `managedBy` value is
reported as-is, since the SDK does not separately expose a folder's owning file). `create` is
never at risk: it only runs when `fetchLive` already found nothing.

`matches` still compares structurally regardless of provisioned status, so a mismatched
declaration against a provisioned object shows `update` in a plan — never a silent, permanently
hidden noop — and only fails, loudly, when reconcile actually tries to write. A declaration that
already matches what is live never reaches `update`/`destroy` at all (the shared engine's
observe-before-write path), so **adopting a provisioned object read-only is safe.**

⚠️ **Measured vs inferred (no live call in this PR).** `DashboardMeta.provisioned`/
`provisionedExternalId` are exactly the fields Grafana's classic dashboard-read response types for
this purpose — high confidence, standard shape. `Folder.managedBy` is INFERRED from the SDK's
schema only: no live instance in this house currently has a file-provisioned FOLDER to read against
(`teslamate-grafana` has none at all — see grafana.md). Treating any non-empty `managedBy` as
provisioned, rather than matching specific string values that were never observed live, is the
conservative reading; confirm against a real provisioned folder before relying on the exact value in
an error message. The panel/target `datasource` auto-decoration `declaredContentMatches` (above)
exists to tolerate is documented Grafana schema-migration behavior, also not re-measured live in
this PR. And `updateFolder`'s `version` field — sent optimistically for concurrency — carries the
SDK's own caveat "only used by the legacy folder implementation"; whether Grafana's newer
unified-storage folder backend honors it at all is unverified (`folder.ts`'s `update`).

## Tests

`folder.test.ts`, `dashboard.test.ts` and `dashboard-model.test.ts` mirror `datasource.test.ts`'s
fake-Grafana harness (`fake-grafana.ts` — the real distilled protocol, only the wire responses
faked). Each proves: a GET never carries a body (`fake.bodies[0]` is `undefined` — the exact
"distilled JSON-encodes unknown keys as a body" trap this family's shared memory names); a
provisioned object refuses update and destroy with no write sent; a transient failure (403/401)
propagates rather than folding to absent; an unchanged declaration is a noop despite `id`/
`version`/`iteration` differing; a 412 propagates uncaught; and the folder `parentUid` reparent
refusal sends no write.
