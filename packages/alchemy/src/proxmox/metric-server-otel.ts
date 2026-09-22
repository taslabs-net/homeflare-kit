/**
 * The `opentelemetry` plugin's option set: what a metric server of that type accepts, how it reads
 * back, and when it has changed.
 *
 * ★ SPLIT OUT OF metric-server.ts TO KEEP IT UNDER THE 250-LINE CAP, AND THE SEAM IS THE PLUGIN.
 *   PVE validates a section against ONE plugin's option set, so these fields mean nothing to a
 *   graphite or influxdb section and theirs mean nothing here. This file answers "what is an OTLP
 *   metric server"; metric-server-form.ts still builds every form, so the clear-list keeps coming
 *   from the one table that also builds the body.
 *
 * ⛔ PVE'S OTLP EXPORTER SPEAKS JSON AND NOTHING ELSE. `PVE::Status::OpenTelemetry::send` sets
 *   `Content-Type: application/json` (pve-manager PVE/Status/OpenTelemetry.pm:643) and gzips by
 *   default; there is no protobuf option. vector's opentelemetry source and VictoriaMetrics both
 *   take protobuf only — measured 2026-09-14 — so a server pointed straight at either fails every
 *   push. That is why C1's declaration points at each node's own vector bridge
 *   (the estate's per-node vector config) rather than at the estate's intake.
 *
 * ⛔ `otel-headers` IS `never`, FOR THE REASON `token` IS. It is where an OTLP bearer token goes —
 *   base64 of a JSON object of arbitrary HTTP headers — and Alchemy persists attributes UNENCRYPTED.
 *   It is also absent from `optional` in metric-server-form.ts, so an undeclared one is never
 *   cleared off a working target on the next plan.
 *
 * ⚠️ `otel-resource-attributes` IS NOT MANAGED AT ALL: not a prop, not read, not compared, not
 *   cleared. It is base64 of a JSON object whose key order nothing canonicalises, so comparing it
 *   means decoding both sides — work with no consumer yet, since nothing sets it and PVE already
 *   stamps `service.name`, `proxmox.cluster` and `proxmox.node` on every request
 *   (`_build_otlp_metrics`, lines 207-228). A hand-set one therefore survives every plan and never
 *   shows as drift. The day one matters, it goes into `optional` and here together.
 */
import { UNSET } from './metric-server-form.ts';
import { bool, int, text } from './values.ts';

export interface MetricServerOtelProps {
  /**
   * ⚠️ PVE'S DEFAULT IS `https`. `http` is for a receiver on the node itself, where the plaintext
   *   never leaves the host; anything further away belongs on `https`.
   */
  'otel-protocol'?: 'http' | 'https';
  /** Unset is PVE's `/v1/metrics`. */
  'otel-path'?: string;
  /** Unset is PVE's `gzip`, sent as `Content-Encoding: gzip`. */
  'otel-compression'?: 'none' | 'gzip';
  /**
   * Per-request HTTP timeout, 1-10 seconds; unset is PVE's 5.
   * ⚠️ pvestatd WAITS THIS LONG, PER REQUEST, AGAINST A RECEIVER THAT HANGS — the send is inline in
   *   its update loop (`send`, line 635) — so this is also how long a broken receiver can stretch
   *   one status cycle.
   */
  'otel-timeout'?: number;
  /** Minimum 1024; unset is PVE's 10000000. pvestatd splits one flush into requests under it. */
  'otel-max-body-size'?: number;
  /** ⚠️ An unset `otel-verify-ssl` means VERIFY — PVE's default, and the safe one. */
  'otel-verify-ssl'?: boolean;
  /** ⛔ `never` ON PURPOSE — see the ⛔ in the header. The compile error is the feature. */
  'otel-headers'?: never;
}

/**
 * ⚠️ THE SAME RULES AS THE REST OF `MetricServerAttributes`. The strings report `''` when the
 *   section carries none — PVE's default is then what the target uses — the numbers report `UNSET`
 *   for the same reason, and `otel-verify-ssl` reports its default directly, because "absent"
 *   there means the target verifies.
 */
export interface MetricServerOtelAttributes {
  'otel-compression': string;
  'otel-max-body-size': number;
  'otel-path': string;
  'otel-protocol': string;
  'otel-timeout': number;
  'otel-verify-ssl': boolean;
}

/** The `otel-*` half of a live section. Read for every type; compared only for this one. */
export const otelAttributes = (live: Record<string, unknown>): MetricServerOtelAttributes => ({
  'otel-compression': text(live['otel-compression']),
  'otel-max-body-size': int(live['otel-max-body-size'], UNSET),
  'otel-path': text(live['otel-path']),
  'otel-protocol': text(live['otel-protocol']),
  'otel-timeout': int(live['otel-timeout'], UNSET),
  'otel-verify-ssl': bool(live['otel-verify-ssl'], true),
});

/**
 * True when every managed `otel-*` field already says what the declaration says.
 *
 * ⛔ EVERY FIELD `optional` SENDS OR CLEARS IS COMPARED HERE, AND NOTHING ELSE IS. A field sent but
 *   not compared is drift a plan can never show; a field compared but not sent is an update the
 *   PUT it triggers can never satisfy, reported forever.
 */
export const otelMatches = (
  attributes: MetricServerOtelAttributes,
  props: MetricServerOtelProps,
): boolean =>
  attributes['otel-compression'] === (props['otel-compression'] ?? '') &&
  attributes['otel-max-body-size'] === (props['otel-max-body-size'] ?? UNSET) &&
  attributes['otel-path'] === (props['otel-path'] ?? '') &&
  attributes['otel-protocol'] === (props['otel-protocol'] ?? '') &&
  attributes['otel-timeout'] === (props['otel-timeout'] ?? UNSET) &&
  attributes['otel-verify-ssl'] === (props['otel-verify-ssl'] !== false);
