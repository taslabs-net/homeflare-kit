/**
 * A metric server's props, as the form PVE wants.
 *
 * ★ SPLIT OUT OF metric-server.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, and the seam is a
 *   real one rather than a convenient line number: this file answers "how does a declaration
 *   become a PVE form", and metric-server.ts answers "what is a metric server and when has it
 *   changed". Nothing here reads the cluster and nothing here decides a diff.
 *
 * ⚠️ THE `import type` BACK TO metric-server.ts IS A CYCLE ON PAPER ONLY. It is type-only, so it
 *   is erased before anything runs — `MetricServerProps` stays the resource's public shape, in the
 *   file that declares the resource, rather than being moved somewhere odd to dodge the arrow.
 *   metric-server-otel.ts imports `UNSET` from here and this file imports nothing back from it,
 *   so no runtime cycle exists either.
 */
import type { MetricServerProps } from './metric-server.ts';
import { withClears } from './values.ts';

/**
 * ⚠️ "NOT SET" CANNOT BE 0 HERE, WHICH IS WHY IT IS -1. `timeout` has a minimum of 0 in PVE's
 *   schema, so a deliberate `timeout 0` exists; a provider using 0 as its absent-marker reads that
 *   zero as "unset" and never clears it. -1 is outside every one of these fields' ranges.
 */
export const UNSET = -1;

const str = (value: number | undefined) => (value === undefined ? undefined : String(value));

/**
 * Every managed optional, per type: the value to send, or undefined for "clear it".
 *
 * ⛔ ONE TABLE FEEDS BOTH HALVES OF AN UPDATE, AND THAT IS THE POINT. A PUT THAT OMITS A FIELD DOES
 *   NOT CLEAR IT — PVE merges the form into the existing section — so a managed optional needs a
 *   matching `delete=` the moment its prop goes away, or `matches` reports an update on every plan
 *   forever. Deriving the form and the delete list from one map makes "managed but not clearable"
 *   impossible to write here, which a separate clear-list would not.
 * ⛔ NOTHING SET OUT OF BAND MAY BE LISTED HERE, `token` FIRST AMONG THEM: a field in this map is
 *   CLEARED whenever it is undeclared, so adding the token would strip a working target's
 *   credential on the next plan — metrics stop, nothing errors, the graph goes flat. `otel-headers`
 *   is absent for the same reason: it is where an OTLP server's bearer token lives.
 * ⚠️ AND THE BRANCHES CANNOT BE ONE SHARED MAP. PVE validates a section against that plugin's own
 *   option set, so `path` on an influxdb server is a hard 400 and `delete=path` there answers "no
 *   such option" — neither is an ignored hint. The opentelemetry plugin has no `mtu` and no
 *   `timeout` at all (its option list is `server`, `port`, `disable` and the `otel-*` family), so
 *   that branch carries neither.
 * ⚠️ graphite's `proto` (udp or tcp) is deliberately absent: a transport chosen by hand stays put
 *   and no plan diffs it. Managing it means adding it HERE, where it is clearable by construction.
 *   `otel-resource-attributes` is absent for the reason metric-server-otel.ts gives.
 */
export const optional = (props: MetricServerProps): Record<string, string | undefined> => {
  switch (props.type) {
    case 'graphite':
      return { mtu: str(props.mtu), path: props.path, timeout: str(props.timeout) };
    case 'influxdb':
      return {
        'api-path-prefix': props['api-path-prefix'],
        bucket: props.bucket,
        influxdbproto: props.influxdbproto,
        'max-body-size': str(props['max-body-size']),
        mtu: str(props.mtu),
        organization: props.organization,
        timeout: str(props.timeout),
      };
    case 'opentelemetry':
      return {
        'otel-compression': props['otel-compression'],
        'otel-max-body-size': str(props['otel-max-body-size']),
        'otel-path': props['otel-path'],
        'otel-protocol': props['otel-protocol'],
        'otel-timeout': str(props['otel-timeout']),
      };
  }
};

/**
 * The certificate-verification flag, for the one plugin that owns it.
 *
 * ⛔ EACH FLAG GOES ONLY TO ITS OWN PLUGIN. `verify-certificate` is influxdb's, `otel-verify-ssl` is
 *   opentelemetry's, graphite has neither — and PVE refuses an option outside the section's plugin
 *   rather than ignoring it, the same way it refuses `path` on influxdb.
 */
const verification = (props: MetricServerProps): Record<string, string> => {
  switch (props.type) {
    case 'graphite':
      return {};
    case 'influxdb':
      return { 'verify-certificate': props['verify-certificate'] === false ? '0' : '1' };
    case 'opentelemetry':
      return { 'otel-verify-ssl': props['otel-verify-ssl'] === false ? '0' : '1' };
  }
};

/**
 * The fields sent on EVERY write, create and update alike.
 *
 * ⚠️ `server` AND `port` ARE REQUIRED BY THE PUT TOO, not only by the POST: a PUT that omits either
 *   fails parameter verification rather than leaving them alone. PVE also refuses to clear them —
 *   "unable to delete required option" — which is why they are here and not in `optional`.
 * ⚠️ `disable` AND THE VERIFY FLAG ARE SENT WITH THEIR DEFAULTS rather than left out. Writing the
 *   value PVE would have assumed makes the read-back match on the first plan after the create,
 *   whether or not that PVE materialises defaults into the file.
 */
const required = (props: MetricServerProps): Record<string, string> => ({
  disable: props.disable === true ? '1' : '0',
  port: String(props.port),
  server: props.server,
  ...verification(props),
});

export const body = (props: MetricServerProps) => {
  const fields = required(props);
  for (const [option, value] of Object.entries(optional(props))) {
    if (value !== undefined) fields[option] = value;
  }
  return fields;
};

/**
 * An update's form: everything `body` sends, plus a `delete=` naming each managed optional that is
 * no longer declared.
 *
 * ★ MOVED HERE FROM metric-server.ts UNCHANGED, so the test beside this file can reach the form an
 *   update really sends instead of re-deriving it and testing its own copy.
 */
export const update = (props: MetricServerProps) => {
  const clear = Object.entries(optional(props))
    .filter(([, value]) => value === undefined)
    .map(([option]) => option);
  return withClears(body(props), clear);
};
