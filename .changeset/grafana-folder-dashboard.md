---
'@homeflare/alchemy': minor
---

`grafana/*` ships `Grafana.Folder` and `Grafana.Dashboard`, on top of the same
`@distilled.cloud/grafana@0.2.0` (aliased onto `@homeflare/distilled-grafana`) operations that
fixed the family's SDK gap: `createFolder`/`getFolderByUID`/`updateFolder`/`deleteFolder` and
`postDashboard`/`getDashboard`/`deleteDashboard`, plus the typed `PreconditionFailed` (412) for
dashboard version conflicts. Same file shape and uid-required doctrine as the existing
`Grafana.Datasource` (`resource.ts`'s shared `GrafanaSpec`/`grafanaOperations`/`grafanaHandlers`,
`grafanaProviders(target)` for credentials). Full detail, including which claims were measured
against the SDK's generated types versus inferred (no live call was made in this PR):
`docs/grafana-folder-dashboard.md`.

**`Grafana.Folder`:** `description` is write-only — MEASURED against the SDK's generated types,
`Folder`'s GET response has no `description` field at all though create/update both accept one —
so it is sent on every write that declares it but never diffed, the same treatment
`Grafana.Datasource` gives `secureJsonDataRefs`. Nesting (`parentUid`) is create-only — MEASURED,
`UpdateFolderRequest` has no `parentUid` field — so a declaration whose `parentUid` no longer
matches the live folder REFUSES with `GrafanaFolderReparentError` instead of silently doing
nothing or deleting-and-recreating under the new parent. `update` sends `version` for optimistic
concurrency, but the SDK's own doc comment on `UpdateFolderRequest.version` says "only used by the
legacy folder implementation" — unverified whether Grafana's newer unified-storage folder backend
honors it at all, flagged rather than presented as a verified 412-style guard. Delete defaults to
`defaultRemovalPolicy: 'retain'`: `deleteFolder` takes every dashboard and alert rule in the
folder with it, the same multi-object-cascade class `openbao/mount.ts` already guards this way
(verified there against Alchemy's own `Apply.ts`, not re-verified here — same engine, same
option). A stack that wants the cascade opts in with `.pipe(RemovalPolicy.destroy())`.

**`Grafana.Dashboard`:** the declared content is the dashboard JSON model, the same shape
Grafana's "Export as JSON" produces. `dashboard-model.ts`'s `normalizeModel` strips
`id`/`version`/`iteration` and forces `uid` to the resource's own value before any comparison, so
a pasted export and a freshly-read live model compare equal and an unchanged dashboard plans as a
true noop despite those fields moving on every live save. `panels` and each panel's `targets` are
array-order-significant and compared positionally; nothing in a dashboard model needed UniFi's
`sortedSet` treatment. **`matches` compares "declaration is a subset of live", not plain
equality** (`declaredContentMatches`) — an adversarial review of this PR found plain structural
equality made an ordinary, never-edited dashboard show `update` forever, because Grafana's own
schema migration on save decorates any panel/target whose `datasource` is absent with an explicit
reference; a declaration silent about a field is now tolerated rather than compared, while a field
it DOES mention is still caught exactly as before (traded off: an omitted field can no longer
force-clear one Grafana or a prior declaration set — see the doc for the full reasoning). Version
conflicts (412) fail loudly and are never overwritten blindly: `update` injects the version this
resource just read into the model it sends and never sets `overwrite`; a genuine conflict
propagates `PreconditionFailed` uncaught and fails the whole reconcile, with the next
plan/deploy's own `fetchLive` serving as the re-read. Delete does **not** default to retain — a
single-object blast radius, the same class `Grafana.Datasource` already accepts.

**Both refuse writes to a provisioned (file-managed) object** — `Folder.managedBy` (non-empty) and
`DashboardMeta.provisioned`/`provisionedExternalId`, checked in `update`/`destroy` before any SDK
call, naming the owning file when Grafana reports one. `matches` still compares structurally
regardless, so a mismatched declaration against a provisioned object shows `update` in a plan
rather than a silently-hidden noop, and only fails at the point reconcile would actually write;
adopting a provisioned object read-only (a declaration matching what is live) never reaches the
refusal. ⚠️ `Folder.managedBy`'s exact values are INFERRED from the SDK's schema, not measured —
no live instance in this house currently has a file-provisioned folder to read (`teslamate-grafana`
has none at all).

Tests (`folder.test.ts`, `dashboard.test.ts`, `dashboard-model.test.ts`) use the family's existing
`fake-grafana.ts` harness — the real distilled protocol, only wire responses faked — and prove:
every request carries only its own declared fields (a GET's body is asserted `undefined`, the
exact "distilled JSON-encodes unknown keys as a body" trap this family's shared memory names);
provisioned objects refuse update/destroy with no write sent; a transient failure (401/403)
propagates rather than folding to absent; an unchanged declaration is a noop despite volatile
fields differing; and a 412 propagates uncaught.
