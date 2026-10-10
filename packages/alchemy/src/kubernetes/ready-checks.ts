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
import { type KeyState, KubernetesReadyBadCheck } from './ready-errors.ts';

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

/**
 * Declaration-time validation (round 1, finding 3): a check that can never be satisfied is a typed
 * refusal, not a 10 minute timeout. ⚠️ Upstream's path builder THROWS for a namespaced kind with an
 * empty namespace (`objects.ts:189-192`), which would otherwise be read as a transport transient.
 */
export const validateChecks = (checks: unknown): KubernetesReadyBadCheck | undefined => {
  if (!Array.isArray(checks) || checks.length === 0) {
    return new KubernetesReadyBadCheck({ index: 0, problem: 'must list at least one check' });
  }
  for (const [index, raw] of checks.entries()) {
    const check = obj(raw);
    const bad = (problem: string) => new KubernetesReadyBadCheck({ index, problem });
    const kind = check['kind'];
    if (kind !== 'DaemonSet' && kind !== 'Deployment' && kind !== 'CustomResourceDefinition') {
      return bad('has an unknown kind');
    }
    if (typeof check['name'] !== 'string' || check['name'] === '') {
      return bad('needs a non-empty name');
    }
    if (kind !== 'CustomResourceDefinition') {
      if (typeof check['namespace'] !== 'string' || check['namespace'] === '') {
        return bad(`needs a non-empty namespace (${kind} is namespaced)`);
      }
    }
    const min = check['minReady'];
    if (min !== undefined && (kind !== 'DaemonSet' || !Number.isInteger(min) || Number(min) < 1)) {
      return bad('minReady is an integer >= 1 and only applies to a DaemonSet');
    }
  }
  return undefined;
};

export type Json = Record<string, unknown>;
export const obj = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};
export const num = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** The numbers a pass saw, for `KubernetesReadyTimeout.states`: counts and generations only. */
export const countsOf = (check: ReadyCheck, body: unknown): KeyState => {
  const status = obj(obj(body)['status']);
  const names =
    check.kind === 'DaemonSet'
      ? [
          'observedGeneration',
          'desiredNumberScheduled',
          'updatedNumberScheduled',
          'numberAvailable',
        ]
      : check.kind === 'Deployment'
        ? ['observedGeneration', 'replicas', 'updatedReplicas', 'availableReplicas']
        : [];
  const counts = Object.fromEntries(names.map((name) => [name, num(status[name])]));
  return { counts: { generation: num(obj(obj(body)['metadata'])['generation']), ...counts } };
};
const conditions = (status: Json): Json[] =>
  Array.isArray(status['conditions']) ? status['conditions'].map(obj) : [];

/** kubectl `rollout_status.go:107-114`; `minReady` defaults to `desiredNumberScheduled`. */
const daemonSet = (body: Json, minReady: number | undefined): Verdict => {
  const status = obj(body['status']);
  // ⛔ kubectl checks the strategy first (`:104-106`). The apiserver defaults the type, so an
  //   absent one is RollingUpdate; `OnDelete` never rolls by itself, so waiting cannot end.
  const strategy = obj(obj(body['spec'])['updateStrategy'])['type'];
  if (strategy !== undefined && strategy !== 'RollingUpdate') return 'failed';
  const generation = num(obj(body['metadata'])['generation']);
  if (num(status['observedGeneration']) < generation) return 'pending';
  const desired = num(status['desiredNumberScheduled']);
  const need = minReady ?? desired;
  // ⚠️ A DaemonSet that wants zero pods (no node matched yet) has rolled out nothing.
  if (need < 1) return 'pending';
  const updated = num(status['updatedNumberScheduled']);
  // ⛔ `numberAvailable` also counts AVAILABLE OLD-TEMPLATE pods, so comparing it to `minReady`
  //   alone passes a broken upgrade: minReady 2 of 4 with two crashlooping new pods and two healthy
  //   old ones reads as 2 updated and 2 available. At most `desired - updated` of the available
  //   pods are old, so the difference is a LOWER BOUND on pods both updated and available (round 1,
  //   finding 1; kubectl gets there by demanding updated == desired).
  const oldAtMost = Math.max(desired - updated, 0);
  return updated >= need && num(status['numberAvailable']) - oldAtMost >= need
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
