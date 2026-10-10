/**
 * The typed errors of `HomeFlare.Kubernetes.Ready` that carry no logic, so a stack can `catchTag`
 * them. ⛔ Every message names check keys, counts, durations and statuses only: never a response
 * body, which is the server's text and not ours to republish.
 */
import * as Data from 'effect/Data';

/** What the poll recorded when a pass last tolerated a transient error: tag and status, no body. */
export interface LastTransient {
  readonly tag: string;
  readonly status?: number;
}

/**
 * What the last pass saw of one check: the object was absent (404), or the numbers it reported.
 * ★ A 404 that never resolves (a typo'd name, a chart that never creates it) must read differently
 *   from a slow rollout, without republishing anything the server said (round 1, finding 3).
 */
export type KeyState =
  | { readonly notFound: true }
  | { readonly counts: Readonly<Record<string, number>> };

const describeState = (state: KeyState | undefined): string => {
  if (state === undefined) return '';
  if ('notFound' in state) return ' (not found)';
  const counts = Object.entries(state.counts).map(([name, value]) => `${name}=${value}`);
  return counts.length === 0 ? '' : ` (${counts.join(' ')})`;
};

/** The gate never opened within `waitTimeout`. `failing` holds check keys only. */
export class KubernetesReadyTimeout extends Data.TaggedError('KubernetesReadyTimeout')<{
  readonly failing: readonly string[];
  readonly seconds: number;
  readonly lastTransient?: LastTransient;
  /** Per failing key, from the last pass that reached it: `notFound`, or the counts seen. */
  readonly states?: Readonly<Record<string, KeyState>>;
}> {
  override get message(): string {
    const failing = this.failing.map((key) => `${key}${describeState(this.states?.[key])}`);
    const last =
      this.lastTransient === undefined
        ? ''
        : `; last transient error ${this.lastTransient.tag}${
            this.lastTransient.status === undefined ? '' : ` ${this.lastTransient.status}`
          }`;
    return `Kubernetes.Ready: not ready within ${this.seconds}s: ${failing.join(', ')}${last}`;
  }
}

/**
 * A rollout that will not finish, which is not pending: a Deployment reported
 * `ProgressDeadlineExceeded`, or a DaemonSet's `updateStrategy` is not `RollingUpdate` (kubectl
 * `rollout_status.go:104-106` errors the same way: `OnDelete` pods never roll by themselves).
 */
export class KubernetesRolloutFailed extends Data.TaggedError('KubernetesRolloutFailed')<{
  readonly check: string;
  readonly reason?: 'ProgressDeadlineExceeded' | 'UpdateStrategyNotRollingUpdate';
}> {
  override get message(): string {
    return this.reason === 'UpdateStrategyNotRollingUpdate'
      ? `Kubernetes.Ready: ${this.check} does not use the RollingUpdate update strategy`
      : `Kubernetes.Ready: ${this.check} exceeded its progress deadline (ProgressDeadlineExceeded)`;
  }
}

/** A `waitTimeout`/`pollInterval` that is not a Go-style duration (`10m0s`, `90s`, `1h30m`). */
export class KubernetesReadyBadDuration extends Data.TaggedError('KubernetesReadyBadDuration')<{
  readonly field: string;
  readonly value: string;
}> {
  override get message(): string {
    return `Kubernetes.Ready: ${this.field} '${this.value}' is not a duration like 10m0s`;
  }
}

/** A check that can never be satisfied, refused at declaration instead of timing out in 10 m. */
export class KubernetesReadyBadCheck extends Data.TaggedError('KubernetesReadyBadCheck')<{
  /** Index into `checks`. */
  readonly index: number;
  readonly problem: string;
}> {
  override get message(): string {
    return `Kubernetes.Ready: checks[${this.index}] ${this.problem}`;
  }
}

/**
 * `after` must hold Outputs of the chart (`chart.objects`). ⛔ A plain value, or a stable such as
 * `chart.connection`, resolves at plan time, so the row would plan `noop` before the chart's
 * update and the gate would be skipped.
 */
export class KubernetesReadyBadAfter extends Data.TaggedError('KubernetesReadyBadAfter')<{
  readonly index: number;
}> {
  override get message(): string {
    return `Kubernetes.Ready: after[${this.index}] is not a lazy Output of the chart (use chart.objects)`;
  }
}
