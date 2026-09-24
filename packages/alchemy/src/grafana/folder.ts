/**
 * `Grafana.Folder` — one Grafana folder, keyed by `uid`. Mirrors `datasource.ts`'s shape and
 * doctrine (uid required, not generated — same reasoning, `getFolderByUID`/`updateFolder`/
 * `deleteFolder` are all UID-keyed and `getFolders` (list) has no per-uid filter).
 *
 * ⛔ `description` IS WRITE-ONLY — MEASURED against `@distilled.cloud/grafana`'s generated types
 *   (`Folder` in services/grafana.ts has no `description` field at all, though
 *   `CreateFolderRequest`/`UpdateFolderRequest` both accept one). Grafana's classic folder GET
 *   never returns it, not even as an is-it-set flag the way `DataSource.secureJsonFields` reports
 *   for a datasource's secure fields. So `description` is sent on every create/update that
 *   declares it but is NEVER part of `matches` — this resource cannot detect drift in a value it
 *   is never shown, the same treatment `datasource.ts` gives `secureJsonDataRefs`.
 *
 * ⚠️ NESTING (`parentUid`) IS CREATE-ONLY — MEASURED against the same generated types.
 *   `CreateFolderRequest.parentUid` exists; `UpdateFolderRequest` has no `parentUid` field at all
 *   (`folder_uid`, `description`, `overwrite`, `title`, `version` — reparenting is simply not a
 *   thing `PUT /folders/{uid}` can do). A declaration whose `parentUid` no longer matches the live
 *   folder therefore REFUSES with `GrafanaFolderReparentError` rather than either silently doing
 *   nothing (which would lie about the declaration taking effect) or deleting and recreating the
 *   folder under the new parent (which — see the ⛔ below — takes every dashboard and alert rule in
 *   it with it). Move a folder by hand in Grafana, then adjust the declaration to match.
 *
 * ⛔ DELETE DEFAULTS TO `retain` — DELETING A FOLDER DELETES ITS DASHBOARDS AND ALERT RULES IN
 *   GRAFANA, per `deleteFolder`'s own operation description ("along with all dashboards (and their
 *   alerts) stored in the folder... cannot be reverted... also deletes all the subfolders"). That
 *   is the same class of multi-object cascade `openbao/mount.ts` guards with
 *   `defaultRemovalPolicy: 'retain'` ("disabling a mount destroys every secret under it") — VERIFIED
 *   there against Alchemy's own `Apply.ts` (not re-verified here; same engine, same option). A
 *   stack that explicitly wants the cascade opts in with `.pipe(RemovalPolicy.destroy())` on the
 *   declared instance; `destroy` below still implements the real DELETE in full either way (S11).
 *   `Grafana.Dashboard` does NOT default to retain — deleting one dashboard is the same
 *   single-object blast radius `Grafana.Datasource` already accepts without a retain guard, not
 *   this family's multi-object cascade.
 *
 * ⛔ A PROVISIONED FOLDER (`managedBy` set — see provisioned.ts) REFUSES EVERY UPDATE AND DESTROY.
 *   `matches` still compares structurally either way, so a mismatched declaration against a
 *   provisioned folder shows `update` in a plan (never a silent, permanently-hidden noop) and then
 *   fails loudly, by design, when reconcile actually tries to write.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as grafana from '@distilled.cloud/grafana';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import { type GrafanaProvisionedObjectError, refuseIfProvisioned } from './provisioned.ts';
import { type GrafanaSpec, grafanaHandlers } from './resource.ts';

export interface FolderProps {
  uid: string;
  title: string;
  /** Write-only — see the file header. Sent on every create/update that declares it; never diffed. */
  description?: string;
  /** Parent folder UID, for nested folders. Create-only — see the file header. */
  parentUid?: string;
}

export interface FolderAttributes {
  uid: string;
  id: number;
  title: string;
  parentUid: string;
  /** Non-empty when Grafana reports this folder as externally managed (e.g. provisioning). */
  managedBy: string;
  url: string;
  version: number;
}

export interface GrafanaFolder extends Resource<
  'Grafana.Folder',
  FolderProps,
  FolderAttributes,
  never
> {}

export const GrafanaFolder = Resource<GrafanaFolder>('Grafana.Folder', {
  defaultRemovalPolicy: 'retain',
});

/** A declared `parentUid` disagrees with the live folder's — `updateFolder` cannot reparent. */
export class GrafanaFolderReparentError extends Data.TaggedError('GrafanaFolderReparentError')<{
  readonly message: string;
}> {}

export const spec: GrafanaSpec<
  FolderProps,
  grafana.Folder,
  FolderAttributes,
  | grafana.CreateFolderError
  | grafana.GetFolderByUIDError
  | grafana.UpdateFolderError
  | grafana.DeleteFolderError
  | GrafanaProvisionedObjectError
  | GrafanaFolderReparentError
> = {
  attributes: (live) => ({
    id: live.id ?? 0,
    managedBy: live.managedBy ?? '',
    parentUid: live.parentUid ?? '',
    title: live.title ?? '',
    uid: live.uid ?? '',
    url: live.url ?? '',
    version: live.version ?? 0,
  }),
  create: (props) =>
    grafana.createFolder({
      uid: props.uid,
      title: props.title,
      ...(props.description === undefined ? {} : { description: props.description }),
      ...(props.parentUid === undefined ? {} : { parentUid: props.parentUid }),
    }),
  destroy: (props, live) =>
    Effect.gen(function* () {
      if (live.managedBy) {
        return yield* refuseIfProvisioned('Grafana.Folder', props.uid, live.managedBy);
      }
      yield* grafana.deleteFolder({ folder_uid: props.uid });
    }),
  fetchLive: (props) =>
    grafana
      .getFolderByUID({ folder_uid: props.uid })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: (attributes, props) =>
    attributes.title === props.title &&
    (props.parentUid === undefined || attributes.parentUid === props.parentUid),
  update: (props, live) =>
    Effect.gen(function* () {
      if (live.managedBy) {
        return yield* refuseIfProvisioned('Grafana.Folder', props.uid, live.managedBy);
      }
      if (props.parentUid !== undefined && props.parentUid !== (live.parentUid ?? undefined)) {
        return yield* Effect.fail(
          new GrafanaFolderReparentError({
            message:
              `Grafana.Folder '${props.uid}' declares parentUid '${props.parentUid}' but is ` +
              `live under '${live.parentUid ?? '(root)'}'. PUT /folders/{uid} cannot reparent a ` +
              `folder — move it by hand in Grafana, then update the declaration to match.`,
          }),
        );
      }
      // ⚠️ UNLIKE DASHBOARD.TS's 412, THIS HAS NO VERIFIED CONFLICT SIGNAL. `version` is sent
      //   optimistically, but the SDK's own doc comment on `UpdateFolderRequest.version` says
      //   "only used by the legacy folder implementation" — on Grafana's newer unified-storage
      //   folder backend it is plausibly ignored outright, meaning two concurrent title/description
      //   writes could silently last-write-win with no error, unlike a dashboard save. NOT
      //   MEASURED against a live instance either way (no live calls in this PR; flagged by an
      //   adversarial review) — sending it is harmless (a no-op field on a backend that ignores it)
      //   and correct on one that still honors it, so it stays, but do not read its PRESENCE here
      //   as proof this resource detects folder update conflicts the way dashboard.ts does.
      return yield* grafana.updateFolder({
        folder_uid: props.uid,
        title: props.title,
        ...(props.description === undefined ? {} : { description: props.description }),
        ...(live.version === undefined ? {} : { version: live.version }),
      });
    }),
};

export const handlers = grafanaHandlers(spec);

export const GrafanaFolderProvider = () =>
  Provider.effect(GrafanaFolder, Effect.succeed(GrafanaFolder.Provider.of(handlers)));
