/**
 * Readiness evaluators for `HomeFlare.Kubernetes.Ready`: pure functions over one object's JSON,
 * plus the typed errors of the gate. No I/O here, so every rule is testable on a literal body.
 *
 * ★ ROLLOUT SEMANTICS, NOT "Available". Copied from `kubectl rollout status` (kubectl v0.34.0
 *   `pkg/polymorphichelpers/rollout_status.go:75-89` Deployment, `:107-114` DaemonSet), because a
 *   gate that only reads `Available`/`numberReady` passes on the OLD ReplicaSet or pods while a
 *   new generation is still rolling out (T10 design v3, red-team round 2, finding 1). The first
 *   rule of both is `status.observedGeneration >= metadata.generation`: until the controller has
 *   seen the latest spec, every count below describes a spec that no longer exists.
 * ⚠️ A body that is missing or not an object is PENDING, never ready: an empty 200 must not open
 *   the gate.
 */
import * as Data from 'effect/Data';

export type ReadyCheck =
  | {
      readonly kind: 'DaemonSet';
      readonly namespace: string;
      readonly name: string;
      readonly minReady?: number;
    }
  | { readonly kind: 'Deployment'; readonly namespace: string; readonly name: string }
  | { readonly kind: 'CustomResourceDefinition'; readonly name: string };

/** `failed` is terminal (kubectl reports it as an error), `pending` is "look again". */
export type Verdict = 'ready' | 'pending' | 'failed';

/** Check keys only: names are public, no body byte ever reaches a key, an error or an attribute. */
export const checkKey = (check: ReadyCheck): string => {
  switch (check.kind) {
    case 'DaemonSet':
      return `DaemonSet/${check.namespace}/${check.name}${
        check.minReady === undefined ? '' : `:min=${check.minReady}`
      }`;
    case 'Deployment':
      return `Deployment/${check.namespace}/${check.name}`;
    case 'CustomResourceDefinition':
      return `CustomResourceDefinition/${check.name}`;
  }
};

export const checksCsv = (checks: readonly ReadyCheck[]): string => checks.map(checkKey).join(',');

/** What the poll recorded when a pass last tolerated a transient error: tag and status, no body. */
export interface LastTransient {
  readonly tag: string;
  readonly status?: number;
}

/** The gate never opened within `waitTimeout`. `failing` holds check keys only. */
export class KubernetesReadyTimeout extends Data.TaggedError('KubernetesReadyTimeout')<{
  readonly failing: readonly string[];
  readonly seconds: number;
  readonly lastTransient?: LastTransient;
}> {
  override get message(): string {
    const last =
      this.lastTransient === undefined
        ? ''
        : `; last transient error ${this.lastTransient.tag}${
            this.lastTransient.status === undefined ? '' : ` ${this.lastTransient.status}`
          }`;
    return `Kubernetes.Ready: not ready within ${this.seconds}s: ${this.failing.join(', ')}${last}`;
  }
}

/** A Deployment reported `ProgressDeadlineExceeded`: a rollout that will not finish, not pending. */
export class KubernetesRolloutFailed extends Data.TaggedError('KubernetesRolloutFailed')<{
  readonly check: string;
}> {
  override get message(): string {
    return `Kubernetes.Ready: ${this.check} exceeded its progress deadline (ProgressDeadlineExceeded)`;
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

type Json = Record<string, unknown>;
const obj = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};
const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
const conditions = (status: Json): Json[] =>
  Array.isArray(status['conditions']) ? status['conditions'].map(obj) : [];

/** kubectl `rollout_status.go:107-114`; `minReady` defaults to `desiredNumberScheduled`. */
const daemonSet = (body: Json, minReady: number | undefined): Verdict => {
  const status = obj(body['status']);
  const generation = num(obj(body['metadata'])['generation']);
  if (num(status['observedGeneration']) < generation) return 'pending';
  const need = minReady ?? num(status['desiredNumberScheduled']);
  // ⚠️ A DaemonSet that wants zero pods (no node matched yet) has rolled out nothing.
  if (need < 1) return 'pending';
  return num(status['updatedNumberScheduled']) >= need && num(status['numberAvailable']) >= need
    ? 'ready'
    : 'pending';
};

/** kubectl `rollout_status.go:75-89`. */
const deployment = (body: Json): Verdict => {
  const status = obj(body['status']);
  const generation = num(obj(body['metadata'])['generation']);
  if (num(status['observedGeneration']) < generation) return 'pending';
  // ★ Checked after the generation rule, as kubectl does: a deadline condition left over from
  //   the previous spec must not fail a rollout the controller has not looked at yet.
  const exceeded = conditions(status).some(
    (c) => c['type'] === 'Progressing' && c['reason'] === 'ProgressDeadlineExceeded',
  );
  if (exceeded) return 'failed';
  const desired =
    obj(body['spec'])['replicas'] === undefined ? 1 : num(obj(body['spec'])['replicas']);
  const updated = num(status['updatedReplicas']);
  return updated === desired &&
    num(status['replicas']) === updated &&
    num(status['availableReplicas']) >= updated
    ? 'ready'
    : 'pending';
};

const established = (body: Json): Verdict =>
  conditions(obj(body['status'])).some((c) => c['type'] === 'Established' && c['status'] === 'True')
    ? 'ready'
    : 'pending';

export const evaluate = (check: ReadyCheck, body: unknown): Verdict => {
  if (typeof body !== 'object' || body === null) return 'pending';
  switch (check.kind) {
    case 'DaemonSet':
      return daemonSet(body as Json, check.minReady);
    case 'Deployment':
      return deployment(body as Json);
    case 'CustomResourceDefinition':
      return established(body as Json);
  }
};
