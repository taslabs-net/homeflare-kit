/**
 * `Grafana.Dashboard` — one Grafana dashboard, keyed by `uid`. Same uid-required doctrine as
 * `datasource.ts`/`folder.ts` (`getDashboard`/`postDashboard`/`deleteDashboard` are all UID-keyed
 * on the wire — `postDashboard`'s own `uid` travels INSIDE the `dashboard` JSON body, not as a
 * request field, because Grafana's classic dashboard-save API has never had one; see
 * `dashboard-model.ts`'s `normalizeModel`, which is what puts it there).
 *
 * ★ THE DECLARED CONTENT IS THE DASHBOARD JSON MODEL — `DashboardProps.dashboard`, the same shape
 *   Grafana's own "Export as JSON" produces. `dashboard-model.ts`'s `normalizeModel` strips the
 *   volatile fields (`id`, `version`, `iteration`) and forces `uid` to this resource's own value
 *   before ANY comparison, so a plan against an unchanged dashboard is a true noop despite those
 *   fields moving on every live save — see that file for the full reasoning, including which
 *   fields (`panels`, `targets`) are array-ORDER-significant and compared as such.
 *
 * ⛔ `matches` COMPARES "IS THE DECLARATION A SUBSET OF WHAT IS LIVE", NOT PLAIN EQUALITY —
 *   `dashboard-model.ts`'s `declaredContentMatches`, added after an adversarial review of this PR
 *   found plain `deepEqual` made an ordinary dashboard show `update` FOREVER: Grafana's own
 *   schema-migration on save decorates any panel/target whose `datasource` is absent with an
 *   explicit reference, so a declaration that never sets one would permanently disagree with what
 *   it reads back. See that function's own header for the full reasoning and the trade-off it
 *   accepts (an omitted field can no longer be used to CLEAR a previously-set one).
 *
 * ⛔ VERSION CONFLICTS (412) FAIL LOUDLY — NEVER OVERWRITTEN BLINDLY. `update` injects the
 *   `version` this resource just read (`live.meta.version`, from the SAME `fetchLive` call
 *   `resource.ts`'s `reconcile` already made before calling `update`) into the model it sends, and
 *   `overwrite` is never set. If Grafana's own version check then still fails — someone else saved
 *   in the gap between that read and this write — `postDashboard` answers `412` and
 *   `PreconditionFailed` is left IN the error union below, uncaught: the whole reconcile fails, the
 *   deploy stops, and nothing is written. The next run's `fetchLive` re-reads the new live version
 *   fresh, which is the "re-read" half of "re-read and fail loudly" — there is no separate retry
 *   loop in this file, because the next `plan`/`deploy` invocation already IS that re-read.
 *
 * ⛔ A PROVISIONED DASHBOARD (`meta.provisioned` — see provisioned.ts) REFUSES EVERY UPDATE AND
 *   DESTROY, naming `meta.provisionedExternalId` (the file) when Grafana reports one. `matches`
 *   still compares structurally regardless, so a mismatched declaration against a provisioned
 *   dashboard shows `update` in a plan rather than a silent, permanently-hidden noop.
 *
 * ⚠️ NO RETAIN DEFAULT, UNLIKE `Grafana.Folder`. Deleting one dashboard is a single-object blast
 *   radius — the same class `Grafana.Datasource` already accepts without a retain guard — not
 *   folder.ts's multi-object cascade (a folder's delete takes its dashboards AND their alert rules
 *   with it). See folder.ts's file header for the full contrast.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as grafana from '@distilled.cloud/grafana';
import * as Effect from 'effect/Effect';
import {
  type DashboardModel,
  declaredContentMatches,
  modelTitle,
  normalizeModel,
} from './dashboard-model.ts';
import { type GrafanaProvisionedObjectError, refuseIfProvisioned } from './provisioned.ts';
import { type GrafanaSpec, grafanaHandlers } from './resource.ts';

export type { DashboardModel };

export interface DashboardProps {
  uid: string;
  /** Omit for the General/root folder. */
  folderUid?: string;
  /** The dashboard JSON model — see the file header. `id`/`version`/`iteration`/`uid` inside it
   *  are ignored; `uid` above is the single source of truth. */
  dashboard: DashboardModel;
}

export interface DashboardAttributes {
  uid: string;
  title: string;
  version: number;
  folderUid: string;
  url: string;
  /** True when Grafana reports this dashboard as file-provisioned (read-only — see provisioned.ts). */
  provisioned: boolean;
  provisionedExternalId: string;
  /** The live model, normalized the same way `matches` compares it. */
  dashboard: DashboardModel;
}

export interface GrafanaDashboard extends Resource<
  'Grafana.Dashboard',
  DashboardProps,
  DashboardAttributes,
  never
> {}

export const GrafanaDashboard = Resource<GrafanaDashboard>('Grafana.Dashboard');

const modelOf = (live: grafana.DashboardFullWithMeta): DashboardModel =>
  live.dashboard !== null && typeof live.dashboard === 'object'
    ? (live.dashboard as DashboardModel)
    : {};

export const spec: GrafanaSpec<
  DashboardProps,
  grafana.DashboardFullWithMeta,
  DashboardAttributes,
  | grafana.GetDashboardError
  | grafana.PostDashboardError
  | grafana.DeleteDashboardError
  | GrafanaProvisionedObjectError
> = {
  attributes: (live, props) => {
    const model = normalizeModel(modelOf(live), props.uid);
    return {
      dashboard: model,
      folderUid: live.meta?.folderUid ?? '',
      provisioned: live.meta?.provisioned ?? false,
      provisionedExternalId: live.meta?.provisionedExternalId ?? '',
      title: modelTitle(model),
      uid: props.uid,
      url: live.meta?.url ?? '',
      version: live.meta?.version ?? 0,
    };
  },
  create: (props) =>
    grafana.postDashboard({
      dashboard: normalizeModel(props.dashboard, props.uid),
      ...(props.folderUid === undefined ? {} : { folderUid: props.folderUid }),
    }),
  destroy: (props, live) =>
    Effect.gen(function* () {
      if (live.meta?.provisioned) {
        return yield* refuseIfProvisioned(
          'Grafana.Dashboard',
          props.uid,
          live.meta.provisionedExternalId,
        );
      }
      yield* grafana.deleteDashboard({ uid: props.uid });
    }),
  fetchLive: (props) =>
    grafana
      .getDashboard({ uid: props.uid })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  matches: (attributes, props) =>
    (props.folderUid === undefined || attributes.folderUid === props.folderUid) &&
    declaredContentMatches(normalizeModel(props.dashboard, props.uid), attributes.dashboard),
  update: (props, live) =>
    Effect.gen(function* () {
      if (live.meta?.provisioned) {
        return yield* refuseIfProvisioned(
          'Grafana.Dashboard',
          props.uid,
          live.meta.provisionedExternalId,
        );
      }
      return yield* grafana.postDashboard({
        dashboard: {
          ...normalizeModel(props.dashboard, props.uid),
          ...(live.meta?.version === undefined ? {} : { version: live.meta.version }),
        },
        ...(props.folderUid === undefined ? {} : { folderUid: props.folderUid }),
      });
    }),
};

export const handlers = grafanaHandlers(spec);

export const GrafanaDashboardProvider = () =>
  Provider.effect(GrafanaDashboard, Effect.succeed(GrafanaDashboard.Provider.of(handlers)));
