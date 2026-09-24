/**
 * The shared refusal for a file-provisioned Grafana object — `Grafana.Folder` and
 * `Grafana.Dashboard` both carry a live signal Grafana itself treats as read-only through the
 * classic write API this family calls: `Folder.managedBy` (non-empty when something other than
 * this API manages the folder — provisioning is the case this house cares about, but the field
 * itself is Grafana's general "who owns this" marker) and `DashboardMeta.provisioned` (paired
 * with `provisionedExternalId`, the file path). A declaration must never attempt a write against
 * either — see docs/grafana-folder-dashboard.md's "provisioned objects" section.
 *
 * ⚠️ THE EXACT `managedBy` VALUES ARE INFERRED FROM THE SDK's SCHEMA, NOT MEASURED. No live
 *   instance in this house currently has a file-provisioned FOLDER to read (docs/grafana.md:
 *   `teslamate-grafana` has none at all; the mini's Grafana provisions dashboards, not folders) and
 *   this PR makes no live calls. `Folder.managedBy` and `DashboardMeta.provisioned` are exactly
 *   the fields the OpenAPI schema types for this purpose — treat any non-empty `managedBy` as
 *   provisioned rather than special-casing specific string values that were never observed live.
 *
 * ⛔ ADOPTING A PROVISIONED OBJECT IS STILL FINE. `read`/`reconcile`'s no-write "already converged"
 *   path (resource.ts) never calls `create`/`update`/`destroy` at all when the declaration already
 *   matches what is live — only an actual attempted WRITE against a provisioned object is refused,
 *   by the two callers of this function inside folder.ts/dashboard.ts's own `update`/`destroy`.
 */
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';

export class GrafanaProvisionedObjectError extends Data.TaggedError(
  'GrafanaProvisionedObjectError',
)<{
  readonly message: string;
}> {}

export const refuseIfProvisioned = (
  kind: 'Grafana.Folder' | 'Grafana.Dashboard',
  uid: string,
  owner: string | undefined,
): Effect.Effect<never, GrafanaProvisionedObjectError> => {
  const ownerClause =
    owner === undefined || owner === ''
      ? `(this Grafana instance did not report an owning file)`
      : `by ${owner}`;
  return Effect.fail(
    new GrafanaProvisionedObjectError({
      message:
        `${kind} '${uid}' is file-provisioned ${ownerClause} and read-only through the classic ` +
        `write API this family calls. Edit the provisioning file instead — declaring this ` +
        `object read-only (a declaration matching what is live) is safe and will never reach ` +
        `this refusal.`,
    }),
  );
};
