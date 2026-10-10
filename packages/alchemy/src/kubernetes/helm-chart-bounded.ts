/**
 * `boundedHelmChartProvider`: upstream's `Kubernetes.HelmChart` provider with a wall-clock deadline
 * on `reconcile` and `read`. Wrapped, never re-implemented (alchemy-provider-standard: use what
 * Alchemy ships).
 *
 * ⛔ WHY (measured 2026-10-09, alchemy 2.0.0-beta.81): `requestJson` in `Kubernetes/internal/client.ts`
 *   sets no timeout and no signal on any request, and retries transport errors only. A hung apiserver
 *   therefore blocks a HelmChart reconcile or read forever, holding the 1h platform token across a
 *   stuck deploy. The deadline turns that into a typed `KubernetesReconcileTimeout`.
 * ★ A DIRECT `Provider(HelmChart)` layer, not a collection member: the engine checks the direct
 *   service before any collection (`Provider.ts` `tryFindProviderRegistrationByType`), so merging
 *   this beside `Kubernetes.providers()` makes the wrapper win with no change to upstream's layer.
 * ⚠️ The interrupted fiber ABANDONS its socket (upstream takes no signal). The run then fails typed
 *   and the process exits once main completes, so a dangling socket cannot hold anything.
 * `diff`, `delete`, `stables` and `aliases` come from upstream by spread, so state identity and
 * replace semantics are exactly upstream's.
 */
import { HelmChart, HelmChartProvider } from 'alchemy/Kubernetes/HelmChart';
import * as Provider from 'alchemy/Provider';
import type * as Context from 'effect/Context';
import * as Data from 'effect/Data';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { parseGoDuration } from './ready.ts';

/** A render + discovery + ~60 server-side-apply PATCHes fit well inside this. */
export const HELM_RECONCILE_TIMEOUT = '5m0s';
/** `read` is one connect (identity GET): a minute is generous. */
export const HELM_READ_TIMEOUT = '1m0s';

/** The deadline passed with no answer from the apiserver. Names the row and seconds only. */
export class KubernetesReconcileTimeout extends Data.TaggedError('KubernetesReconcileTimeout')<{
  readonly id: string;
  readonly operation: 'reconcile' | 'read';
  readonly seconds: number;
}> {
  override get message(): string {
    return `Kubernetes.HelmChart ${this.id}: ${this.operation} did not finish within ${this.seconds}s (the apiserver stopped answering)`;
  }
}

const bound = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  deadline: Duration.Duration,
  id: string,
  operation: 'reconcile' | 'read',
): Effect.Effect<A, E | KubernetesReconcileTimeout, R> =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: deadline,
      orElse: () =>
        Effect.fail(
          new KubernetesReconcileTimeout({ id, operation, seconds: Duration.toSeconds(deadline) }),
        ),
    }),
  );

// `Provider(type)` is typed as an Effect; at runtime it is the service key the engine looks up.
const HelmChartKey = Provider.Provider<HelmChart>(HelmChart.Type) as unknown as Context.Service<
  Provider.Provider<HelmChart>,
  Provider.ProviderService<HelmChart>
>;

/**
 * ⛔ A malformed duration dies at layer build (`Effect.orDie`), never becomes a silent unbounded
 *   call: a bad override cannot quietly drop the deadline.
 */
export const boundedHelmChartProvider = (
  reconcileTimeout: string = HELM_RECONCILE_TIMEOUT,
  readTimeout: string = HELM_READ_TIMEOUT,
) =>
  Layer.effect(
    HelmChartKey,
    Effect.gen(function* () {
      const inner = yield* HelmChartKey;
      const reconcileDeadline = yield* parseGoDuration('reconcileTimeout', reconcileTimeout);
      const innerRead = inner.read?.bind(inner);
      const readDeadline = yield* parseGoDuration('readTimeout', readTimeout);
      return {
        ...inner,
        reconcile: (input) =>
          bound(inner.reconcile(input), reconcileDeadline, input.id, 'reconcile'),
        ...(innerRead === undefined
          ? {}
          : { read: (input) => bound(innerRead(input), readDeadline, input.id, 'read') }),
      } satisfies Provider.ProviderService<HelmChart>;
    }).pipe(Effect.orDie),
  ).pipe(Layer.provide(HelmChartProvider()));
