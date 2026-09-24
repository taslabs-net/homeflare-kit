/** Pure existing forms, normalization and equality, shared by plan and SDK lifecycle. */
import type { MetricServerAttributes, MetricServerProps } from './metric-server.ts';
import type { PveSpec } from './resource-spec.ts';
import { UNSET, createBody, update } from './metric-server-form.ts';
import { otelAttributes, otelMatches } from './metric-server-otel.ts';
import { bool, int, text } from './values.ts';

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

export const metricServerSpec = {
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
} satisfies PveSpec<MetricServerProps, MetricServerAttributes>;
