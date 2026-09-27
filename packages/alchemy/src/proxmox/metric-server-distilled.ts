/** Metric-server SDK transport; pve-manager 9.2.11, no change to managed/secret fields. */
import * as cluster from '@distilled.cloud/proxmox/cluster';
import { ProxmoxParseError } from '@distilled.cloud/proxmox/Errors';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { asForm } from './distilled-guard.ts';
import { runPve } from './distilled-pve.ts';
import { metricServerSpec } from './metric-server-config.ts';
import type { MetricServerProps } from './metric-server.ts';

/**
 * The vendor intentionally leaves this plugin-dependent response unstructured in its
 * schema. Decode only the object envelope, then use the existing per-plugin normalization.
 * A malformed response fails without including header credentials in a schema diagnostic.
 */
export const readMetricServerRow = (props: MetricServerProps) =>
  runPve(props.target, 'read', false, cluster.getClusterMetricsServer({ id: props.id })).pipe(
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown))(body).pipe(
        Effect.mapError(
          () =>
            new ProxmoxParseError({
              body: undefined,
              cause: 'Metric server response must be an object',
            }),
        ),
      ),
    ),
    Effect.catchTag('MetricServerNotFound', () => Effect.succeed(undefined)),
    Effect.catchTag('NotFound', () => Effect.succeed(undefined)),
  );

export const readMetricServer = (props: MetricServerProps) =>
  readMetricServerRow(props).pipe(
    Effect.map((row) => (row === undefined ? undefined : metricServerSpec.attributes(row, props))),
  );

/** Map only the existing form's declared keys; token and otel-headers never enter this map. */
export const metricServerRequest = (
  props: MetricServerProps,
  form: Record<string, string>,
): cluster.PutClusterMetricsServerRequest => ({
  ...asForm({
    api_path_prefix: form['api-path-prefix'],
    bucket: form['bucket'],
    delete: form['delete'],
    disable: form['disable'],
    influxdbproto: form['influxdbproto'],
    max_body_size: form['max-body-size'],
    mtu: form['mtu'],
    organization: form['organization'],
    otel_compression: form['otel-compression'],
    otel_max_body_size: form['otel-max-body-size'],
    otel_path: form['otel-path'],
    otel_protocol: form['otel-protocol'],
    otel_timeout: form['otel-timeout'],
    otel_verify_ssl: form['otel-verify-ssl'],
    path: form['path'],
    timeout: form['timeout'],
    verify_certificate: form['verify-certificate'],
  } satisfies { [K in keyof cluster.PutClusterMetricsServerRequest]?: string | undefined }),
  id: props.id,
  port: String(props.port),
  server: props.server,
});

/**
 * Vendor DELETE dereferences the plugin without an absent-row check (MetricServer.pm:293).
 * A typed GET miss therefore skips DELETE. A race or any other SDK error still propagates;
 * never reinterpret an arbitrary 500 from deleting an invalid section as success.
 */
export const deleteMetricServer = (props: MetricServerProps) =>
  Effect.gen(function* () {
    if ((yield* readMetricServerRow(props)) === undefined) return;
    yield* runPve(
      props.target,
      'provision',
      true,
      cluster.deleteClusterMetricsServer({ id: props.id }),
    );
  });
