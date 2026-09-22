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
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { UNSET, createBody, update } from './metric-server-form.ts';
import {
  type MetricServerOtelAttributes,
  type MetricServerOtelProps,
  otelAttributes,
  otelMatches,
} from './metric-server-otel.ts';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import { bool, int, text } from './values.ts';

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
 * The type-specific half of `matches`.
 *
 * ⛔ ONLY FIELDS THIS TYPE ACTUALLY SENDS ARE COMPARED. `verify-certificate` is not in graphite's
 *   option set and `path` is not in influxdb's, so neither is ever sent to the wrong plugin — and
 *   diffing one anyway would report an update that the PUT it triggers cannot satisfy, forever.
 *   `mtu` and `timeout` are compared for graphite and influxdb only, because the opentelemetry
 *   plugin has neither and `optional` never sends them to it.
 */
const matchesType = (attributes: MetricServerAttributes, props: MetricServerProps): boolean => {
  if (props.type === 'opentelemetry') return otelMatches(attributes, props);
  const socket =
    attributes.mtu === (props.mtu ?? UNSET) && attributes.timeout === (props.timeout ?? UNSET);
  if (props.type === 'graphite') return socket && attributes.path === (props.path ?? '');
  return (
    socket &&
    attributes.influxdbproto === (props.influxdbproto ?? '') &&
    attributes.organization === (props.organization ?? '') &&
    attributes.bucket === (props.bucket ?? '') &&
    attributes['api-path-prefix'] === (props['api-path-prefix'] ?? '') &&
    attributes['max-body-size'] === (props['max-body-size'] ?? UNSET) &&
    attributes['verify-certificate'] === (props['verify-certificate'] !== false)
  );
};

const handlers = pveHandlers<MetricServerProps, MetricServerAttributes>({
  attributes: (live, props) => {
    /**
     * ⛔ A SERVER OF ANOTHER TYPE IS ANOTHER OBJECT, AND "ABSENT" IS THE HONEST ANSWER. `type`
     *   cannot be changed by a PUT, so reporting the foreign section as missing makes reconcile
     *   POST instead and PVE refuses because the id is taken — a loud, accurate error rather than a
     *   PUT pushing influxdb fields at a graphite section. An older PVE that omits `type` from the
     *   read falls through and is trusted.
     */
    const liveType = text(live['type']);
    if (liveType !== '' && liveType !== props.type) return undefined;
    return {
      ...otelAttributes(live),
      'api-path-prefix': text(live['api-path-prefix']),
      bucket: text(live['bucket']),
      disable: bool(live['disable'], false),
      id: props.id,
      influxdbproto: text(live['influxdbproto']),
      'max-body-size': int(live['max-body-size'], UNSET),
      mtu: int(live['mtu'], UNSET),
      organization: text(live['organization']),
      path: text(live['path']),
      port: int(live['port'], 0),
      server: text(live['server']),
      timeout: int(live['timeout'], UNSET),
      type: props.type,
      'verify-certificate': bool(live['verify-certificate'], true),
    };
  },
  /** ⛔ THE SAME STRING AS `path`, DELIBERATELY — see the ⛔ in the header. */
  collection: (props) => `cluster/metrics/server/${props.id}`,
  /** ⚠️ `type` IS REQUIRED ON CREATE; `id` IS NOT SENT, because the id is the path. */
  createForm: createBody,
  /**
   * The vendor rules both forms are checked against at plan time — resource-spec.ts.
   * ⚠️ POST AND PUT ARE THE SAME PATH HERE, and they are still two different tables: only the
   *   POST marks `type` required, and only the PUT accepts `delete` and `digest`.
   */
  endpoint: {
    create: 'pve:POST /cluster/metrics/server/{id}',
    update: 'pve:PUT /cluster/metrics/server/{id}',
  },
  /**
   * ⛔ `id` and `type` are absent: one is the key the object was read by, the other is refused
   *   rather than updated. Everything type-specific is `matchesType`'s, above.
   */
  matches: (attributes, props) =>
    attributes.server === props.server &&
    attributes.port === props.port &&
    attributes.disable === (props.disable === true) &&
    matchesType(attributes, props),
  path: (props) => `cluster/metrics/server/${props.id}`,
  /** The form and its clear-list, from the one table in metric-server-form.ts. */
  updateForm: update,
});

/**
 * ⛔ THE EMPTY `list` FROM `pveHandlers` EARNS ITS KEEP HERE. `GET cluster/metrics/server` answers
 *   with every target the cluster already ships to, including the one somebody configured by hand
 *   years ago; adopting that is how a later `alchemy destroy` silences a graph nobody declared.
 * ⚠️ AND NOTHING BRAKES THIS DESTROY. A pool refuses while it holds guests, a container while it
 *   runs; a metric server just leaves `status.cfg`, the cluster stops shipping on the next
 *   interval, and no guest or task is affected. The plan diff is the only warning anyone gets —
 *   the top of this file again, this time caused by a deploy.
 */
export const ProxmoxMetricServerProvider = () =>
  Provider.effect(ProxmoxMetricServer, Effect.succeed(ProxmoxMetricServer.Provider.of(handlers)));
