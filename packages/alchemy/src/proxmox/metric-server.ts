/**
 * `Proxmox.MetricServer` — where the cluster ships its metrics, declared.
 *
 * ★ THE FAILURE THIS PREVENTS IS A SILENT ONE, WHICH IS THE WHOLE ARGUMENT FOR DECLARING IT.
 *   Undeclared, the target exists only as a section of `/etc/pve/status.cfg`: rebuild a node,
 *   re-add one to the cluster, or restore a config from before it was configured, and the cluster
 *   stops shipping. Nothing fails, no task errors, no alert fires — the graphs go flat, and the
 *   first to find out is whoever went looking for a number that was not there.
 *
 * ⛔ CREATE IS `POST cluster/metrics/server/{id}` — THE OBJECT'S OWN PATH — SO `collection()`
 *   RETURNS THE SAME STRING AS `path()`, AND THAT IS NOT A TYPO. MEASURED: a POST to the
 *   collection answers "Method 'POST /cluster/metrics/server' not implemented", while the id path
 *   gets as far as a permission check (`/`, Sys.Modify); the published schema agrees, giving the
 *   collection a GET and nothing else. `createForm` omits `id` for the same reason — it is already
 *   the last segment of the path being POSTed to, and a second copy can only disagree with it.
 *
 * ⛔ THE `token` IS WRITE-ONLY AND MUST NEVER BECOME AN ATTRIBUTE. Alchemy persists attributes
 *   UNENCRYPTED, so one that reached state would outlive the change that set it, in the state
 *   store and in every backup of it. It is `never` in the props below — declaring one is a COMPILE
 *   ERROR rather than a leak found months later — and absent from `optional`, for the reason
 *   given there. Set it out of band; PVE never returns it on a read anyway. `otel-headers`, where an
 *   opentelemetry server's bearer token lives, gets the same treatment in metric-server-otel.ts.
 *
 * ⚠️ PRIVILEGES, AND THIS IS A BIGGER ASK THAN IT LOOKS. Read and diff are fine under an auditor
 *   lease — the single-object GET checks `Sys.Audit` on `/` — while create, update and delete all
 *   check `Sys.Modify` on `/` and answer "Permission check failed (/, Sys.Modify)" until the role
 *   is widened. Widen it knowingly: the ACL path is the ROOT and there is no `/metrics` object to
 *   scope to, so `Sys.Modify` also buys datacenter options, notification targets and every other
 *   cluster-wide config write. A separate role for metric writes is the narrower answer.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as cluster from '@distilled.cloud/proxmox/cluster';
import { runPve } from './distilled-pve.ts';
import { specGuards } from './resource-guard.ts';
import { metricServerSpec } from './metric-server-config.ts';
import {
  deleteMetricServer,
  metricServerRequest,
  readMetricServer,
} from './metric-server-distilled.ts';

import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import {
  type MetricServerOtelAttributes,
  type MetricServerOtelProps,
} from './metric-server-otel.ts';
import type { PveRequirements, WithTarget } from './resource-spec.ts';

/**
 * PVE's status plugins. Which one a server is decides which fields it will even accept.
 *
 * ★ `opentelemetry` IS OFFERED SINCE 2026-09-14, AND THE REASON IT WAS NOT STILL HOLDS FOR ANY FIELD
 *   LEFT OUT. Its whole configuration is the `otel-*` family; declared without managing that family
 *   it would build a target whose every meaningful setting sat outside the graph, and report `noop`
 *   over it. metric-server-otel.ts manages every `otel-*` field but two, and says why for each.
 */
export type MetricServerType = 'graphite' | 'influxdb' | 'opentelemetry';

export interface MetricServerProps extends WithTarget, MetricServerOtelProps {
  /** ⚠️ A `pve-configid` — a letter, then letters, digits, `-` and `_`. A rejected one fails with
   *   "invalid configuration ID", which reads as a broken request rather than as a naming rule. */
  id: string;
  /**
   * ⛔ CREATE-TIME ONLY. The PUT schema has no `type` parameter at all: a section's type is fixed
   *   when it is written, so the ⛔ in `attributes` turns a changed type into a refusal rather than
   *   a silent no-op over the wrong target.
   */
  type: MetricServerType;
  /** ⚠️ REQUIRED ON EVERY WRITE, UPDATE INCLUDED — see `required`. */
  server: string;
  port: number;
  /** Keep the section but stop shipping. Unset is an ENABLED target, not an absent one. */
  disable?: boolean;
  /**
   * graphite and influxdb only: UDP MTU (512-65536) and socket/HTTP timeout. Unset leaves PVE's
   * defaults, 1500 and 1. ⚠️ opentelemetry has neither; its timeout is `otel-timeout`.
   */
  mtu?: number;
  timeout?: number;
  /** graphite only: the root path metrics are published under, e.g. `proxmox.mycluster`. */
  path?: string;
  /**
   * influxdb only. `udp` is PVE's default and writes line protocol; `http`/`https` use the v2 API,
   * the only place `organization` and `bucket` mean anything. An unset `verify-certificate` means
   * VERIFY — PVE's default, and the safe one.
   * ⚠️ PVE's hyphenated names are kept rather than camelCased, so nothing between here and the form
   *   body has to remember a mapping.
   */
  influxdbproto?: 'udp' | 'http' | 'https';
  organization?: string;
  bucket?: string;
  'api-path-prefix'?: string;
  'max-body-size'?: number;
  'verify-certificate'?: boolean;
  /** ⛔ `never` ON PURPOSE — see the ⛔ in the header. The compile error is the feature. */
  token?: never;
}

/**
 * ⛔ NO `digest`, ON PURPOSE. PVE returns one with every read, but it is the digest of the WHOLE
 *   `status.cfg` rather than of this section — declaring a SECOND metric server would rewrite this
 *   one's stored attributes, and comparing it would report an update on a target nobody touched.
 *   ⛔ And no `token`, for the reason the header gives at length.
 * ⚠️ `mtu`, `timeout` and `max-body-size` report `UNSET` when the section carries none, i.e. when
 *   PVE's own default is what the target will use; `verify-certificate` reports that default
 *   directly, because "absent" there means the target verifies. `port` reports 0 only for a
 *   malformed section — PVE requires a port — so a plan should say so loudly. The `otel-*` half
 *   follows the same rules; see metric-server-otel.ts.
 */
export interface MetricServerAttributes extends MetricServerOtelAttributes {
  id: string;
  type: MetricServerType;
  server: string;
  port: number;
  disable: boolean;
  mtu: number;
  timeout: number;
  path: string;
  influxdbproto: string;
  organization: string;
  bucket: string;
  'api-path-prefix': string;
  'max-body-size': number;
  'verify-certificate': boolean;
}

export interface ProxmoxMetricServer extends Resource<
  'Proxmox.MetricServer',
  MetricServerProps,
  MetricServerAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxMetricServer = Resource<ProxmoxMetricServer>('Proxmox.MetricServer');

/**
 * ⛔ THE EMPTY `list` KEEPS ADOPTION EXPLICIT. `GET cluster/metrics/server` answers
 *   with every target the cluster already ships to, including the one somebody configured by hand
 *   years ago; adopting that is how a later `alchemy destroy` silences a graph nobody declared.
 * ⚠️ AND NOTHING BRAKES THIS DESTROY. A pool refuses while it holds guests, a container while it
 *   runs; a metric server just leaves `status.cfg`, the cluster stops shipping on the next
 *   interval, and no guest or task is affected. The plan diff is the only warning anyone gets —
 *   the top of this file again, this time caused by a deploy.
 */
const { guardCreate, guardUpdate } = specGuards(metricServerSpec);

/** SDK lifecycle walked against pve-manager 9.2.11; failed reads never imply create. */
export const ProxmoxMetricServerProvider = () =>
  Provider.effect(
    ProxmoxMetricServer,
    Effect.succeed(
      ProxmoxMetricServer.Provider.of({
        list: () => Effect.succeed([]),
        read: ({ olds }) => readMetricServer(olds),
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          yield* guardCreate(news, output === undefined);
          yield* guardUpdate(news);
          if (output === undefined) return undefined;
          const live = yield* readMetricServer(news);
          if (live === undefined) {
            yield* guardCreate(news, true);
            return { action: 'update' } as const;
          }
          return { action: metricServerSpec.matches(live, news) ? 'noop' : 'update' } as const;
        }),
        reconcile: Effect.fn(function* ({ news }) {
          const live = yield* readMetricServer(news);
          yield* guardCreate(news, live === undefined);
          yield* guardUpdate(news);
          if (live === undefined) {
            yield* runPve(
              news.target,
              'provision',
              true,
              cluster.updateClusterMetricsServer({
                ...metricServerRequest(news, metricServerSpec.createForm(news)),
                type: news.type,
              }),
            );
          } else if (!metricServerSpec.matches(live, news)) {
            yield* runPve(
              news.target,
              'provision',
              true,
              cluster.putClusterMetricsServer(
                metricServerRequest(news, metricServerSpec.updateForm(news)),
              ),
            );
          }
          const after = yield* readMetricServer(news);
          if (after === undefined)
            return yield* Effect.fail(
              new Error(
                `${metricServerSpec.path(news)}: write returned success but the resource is still absent`,
              ),
            );
          return after;
        }),
        delete: ({ olds }) => deleteMetricServer(olds),
      }),
    ),
  );
