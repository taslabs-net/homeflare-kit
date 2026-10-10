/**
 * `HomeFlare.Kubernetes.Ready` — a readiness gate other rows depend on via `after`/Output edges.
 *
 * ★ WHY IT EXISTS. Upstream ships no readiness resource: `Kubernetes.HelmChart` reconcile returns
 *   when server-side apply returns, and `Apply` releases the downstream rows at that moment, so a
 *   row chained after the Cilium chart would start before one Cilium pod runs (T10 design v3 §2).
 * ★ SEMANTICS are `kubectl rollout status` (`ready-checks.ts`), the polling rules are in
 *   `ready-poll.ts`. Reconcile polls to `waitTimeout`; `read`/`diff` take ONE pass, so a plan is
 *   live (like `Talos.ClusterHealth`) but never waits.
 * ⛔ `connection` IS A LITERAL `talos-openbao` CONNECTION, refused otherwise at declaration and in
 *   `diff` (`literal-connection.ts`), and it is copied onto the attributes so this row is
 *   `ClusterLike` (`stables`, as upstream's `HelmChart`). It carries a uid, never a credential.
 * ⛔ NO SECRET REACHES ANYTHING THIS ROW WRITES: errors and attributes name check keys, counts and
 *   an error tag + status only, never a response body.
 * ⚠️ `delete` is a no-op and `list` is empty: the row owns nothing in the cluster.
 *
 * Walked against alchemy@2.0.0-beta.81 (`Kubernetes/internal/client.ts` `readObject`,
 * `KubernetesApiError`); only the fake apiserver was used. Not exercised against a live cluster.
 */
import { Resource } from 'alchemy';
import { connectCluster } from 'alchemy/Kubernetes/internal/client';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import type { TalosOpenBaoConnection } from '../talos/cluster-adapter.ts';
import { literalConnectionRefusal, withLiteralConnection } from '../talos/literal-connection.ts';
import type { TalosRequirements } from '../talos/resource.ts';
import { KubernetesReadyBadDuration, type ReadyCheck, checksCsv } from './ready-checks.ts';
import { pass, poll } from './ready-poll.ts';

export interface ReadyProps {
  /** Literal `talos-openbao` connection (uid proven at connect). */
  connection: TalosOpenBaoConnection;
  checks: readonly ReadyCheck[];
  /** Reconcile deadline, Go style. Default `10m0s`. */
  waitTimeout?: string;
  /** Pause between passes, Go style. Default `10s`. */
  pollInterval?: string;
  /** Ordering edge, e.g. `[chart.objects]`. */
  after?: readonly unknown[];
}

export interface ReadyAttributes {
  connection: TalosOpenBaoConnection;
  ready: boolean;
  /** The check keys, comma separated: a changed list is an `update`. */
  checks: string;
}

export interface KubernetesReady extends Resource<
  'HomeFlare.Kubernetes.Ready',
  ReadyProps,
  ReadyAttributes,
  never,
  TalosRequirements
> {}

// ⛔ Declaration-time literal guard: a fresh resource skips `diff` (see `withLiteralConnection`).
export const KubernetesReady = withLiteralConnection(
  Resource<KubernetesReady>('HomeFlare.Kubernetes.Ready'),
);

const UNITS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000 };

/** `10m0s`, `90s`, `1h30m`: whole-number Go durations in h/m/s. Anything else is typed-refused. */
export const parseGoDuration = (field: string, value: string) =>
  Effect.gen(function* () {
    const parts = [...value.matchAll(/(\d+)([hms])/g)];
    if (parts.length === 0 || parts.map((p) => p[0]).join('') !== value) {
      return yield* Effect.fail(new KubernetesReadyBadDuration({ field, value }));
    }
    const ms = parts.reduce(
      (sum, [, n, unit]) => sum + Number(n) * (UNITS[unit as string] ?? 0),
      0,
    );
    return Duration.millis(ms);
  });

const attributes = (props: ReadyProps, ready: boolean): ReadyAttributes => ({
  checks: checksCsv(props.checks),
  connection: props.connection,
  ready,
});

/** ⚠️ A row saved before `connection` existed has none at runtime: missing means "update". */
const sameConnection = (left: TalosOpenBaoConnection, right: TalosOpenBaoConnection | undefined) =>
  right?.auth?.kind === left.auth.kind &&
  right.auth.uid === left.auth.uid &&
  !Object.hasOwn(right.auth, 'cluster');

/** One pass: `ready` only when every check is ready. A terminal failure is not ready either. */
export const readReady = (props: ReadyProps) =>
  Effect.gen(function* () {
    const transport = yield* connectCluster(props.connection);
    const result = yield* pass(transport, props.checks, false);
    return attributes(props, result.pending.length === 0 && result.failed.length === 0);
  });

export const reconcileReady = (props: ReadyProps) =>
  Effect.gen(function* () {
    const waitTimeout = yield* parseGoDuration('waitTimeout', props.waitTimeout ?? '10m0s');
    const pollInterval = yield* parseGoDuration('pollInterval', props.pollInterval ?? '10s');
    const transport = yield* connectCluster(props.connection);
    yield* poll(transport, props.checks, waitTimeout, pollInterval);
    return attributes(props, true);
  });

export const diffReady = (news: Input<ReadyProps>, output: ReadyAttributes | undefined) =>
  Effect.gen(function* () {
    // ⛔ Refuse an Output connection while it is still an Input (`literal-connection.ts`).
    const refused = literalConnectionRefusal((news as { connection?: unknown }).connection);
    if (refused !== undefined) return yield* Effect.fail(refused);
    if (output === undefined || !isResolved(news)) return undefined;
    const live = yield* readReady(news);
    return live.ready &&
      sameConnection(live.connection, output.connection) &&
      live.checks === output.checks
      ? ({ action: 'noop' } as const)
      : ({ action: 'update' } as const);
  });

const handlers = {
  delete: () => Effect.void,
  diff: ({ news, output }: { news: Input<ReadyProps>; output: ReadyAttributes | undefined }) =>
    diffReady(news, output),
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: ReadyProps }) => readReady(olds),
  reconcile: ({ news }: { news: ReadyProps }) => reconcileReady(news),
  stables: ['connection'] as (keyof ReadyAttributes)[],
};

export const KubernetesReadyProvider = () =>
  Provider.effect(KubernetesReady, Effect.succeed(KubernetesReady.Provider.of(handlers)));
