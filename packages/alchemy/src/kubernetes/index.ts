/**
 * Kubernetes helpers for Alchemy that upstream does not ship.
 *
 * ⛔ A DELIBERATELY SMALL BARREL (the `talos/index.ts` rule): the resource, its provider, its
 *   props and the typed errors a stack can `catchTag`. The evaluators and the poll stay internal.
 */
export {
  KubernetesReady,
  KubernetesReadyProvider,
  type ReadyAttributes,
  type ReadyProps,
} from './ready.ts';
export type { ReadyCheck } from './ready-checks.ts';
export {
  KubernetesReadyBadAfter,
  KubernetesReadyBadCheck,
  KubernetesReadyBadDuration,
  KubernetesReadyTimeout,
  KubernetesRolloutFailed,
} from './ready-errors.ts';
export { KubernetesReadyApiError, KubernetesReadyGetTimeout } from './ready-poll.ts';
