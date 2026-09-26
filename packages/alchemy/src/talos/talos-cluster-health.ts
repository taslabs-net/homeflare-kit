/**
 * `Talos.ClusterHealth` — readiness gate other resources can depend on via `after`.
 *
 * ★ REASONED FROM talosctl health (Talos v1.13 CLI reference): checks Talos services, etcd, and
 *   Kubernetes component health; `--wait-timeout` defaults to 20m0s.
 *
 * ⚠️ PLAN READS USE A SHORT TIMEOUT SO `plan` DOES NOT BLOCK TWENTY MINUTES. Reconcile uses the
 *   declared timeout — that is the deploy gate, not the plan gate.
 *
 * ⛔ THIS RESOURCE ASSUMES A CNI IS ALREADY RUNNING (K-talos-first-boot, 2026-09-26). The default
 *   `talosctl health` suite checks nodes Ready, kube-proxy and CoreDNS, and Talos's own source
 *   comment says these wait on the CNI (REASONED, `pkg/cluster/check/default.go:28-60,89-91`;
 *   docs/plans/2026-09-26-talos-stack-first-boot.md's "CNI ordering" section). A consuming stack's
 *   `after` MUST include the Cilium install step, not just `Talos.Bootstrap`/`Talos.Kubeconfig` —
 *   declaring this row directly after bootstrap deadlocks into the `--wait-timeout` on every first
 *   deploy, because Argo CD itself needs pod networking before it can install Cilium. Row order:
 *   Bootstrap → Kubeconfig → Cilium (inline manifests in the seeded machine config, D-S2) →
 *   `Talos.ClusterHealth`.
 * ⛔ NO SWALLOWED TRANSPORT ERRORS (K-talos-first-boot) — the shipped `read` caught EVERY error
 *   from `check()`, including a `mintTalosconfig`/`bao` failure, into a plain `healthy: false`. A
 *   vault outage would then read as "cluster not healthy yet" — an operator chasing a Cilium
 *   rollout would never learn the real problem was vault. Both `read` and `reconcile` now only
 *   catch `TalosError` (`talosctl health` itself ran and exited non-zero — the one case this
 *   family may honestly call "not healthy"); anything else propagates untouched.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { mintTalosconfig } from './credentials.ts';
import type { TalosRequirements, WithTarget } from './resource.ts';
import { TalosError, talosctl } from './talosctl.ts';

export interface ClusterHealthProps extends WithTarget {
  /** Control-plane node IPs passed to `--control-plane-nodes`. */
  controlPlaneNodes: readonly string[];
  /** Worker node IPs passed to `--worker-nodes`. */
  workerNodes?: readonly string[];
  /**
   * Reconcile wait (`--wait-timeout`), e.g. `20m0s`. Default from published CLI.
   *
   * ⚠️ REASONED default — not measured here.
   */
  waitTimeout?: string;
  /**
   * Ordering edge. ⛔ MUST reach past `Talos.Bootstrap`/`Talos.Kubeconfig` all the way through the
   * Cilium CNI install (this file's own header, "CNI ordering") — the default health checks wait
   * on kube-proxy and CoreDNS, both of which wait on a CNI that does not exist yet at bootstrap.
   */
  after?: readonly unknown[];
}

export interface ClusterHealthAttributes {
  healthy: boolean;
  controlPlaneNodes: string;
  workerNodes: string;
}

export interface TalosClusterHealth extends Resource<
  'Talos.ClusterHealth',
  ClusterHealthProps,
  ClusterHealthAttributes,
  never,
  TalosRequirements
> {}

export const TalosClusterHealth = Resource<TalosClusterHealth>('Talos.ClusterHealth');

const nodeCsv = (nodes: readonly string[] | undefined) =>
  nodes === undefined || nodes.length === 0 ? '' : nodes.join(',');

const healthArgs = (props: ClusterHealthProps, waitTimeout: string) => {
  const args = ['health', '--wait-timeout', waitTimeout];
  const cp = nodeCsv(props.controlPlaneNodes);
  const workers = nodeCsv(props.workerNodes);
  if (cp !== '') args.push('--control-plane-nodes', cp);
  if (workers !== '') args.push('--worker-nodes', workers);
  return args;
};

/**
 * ⛔ WRAPPED IN `Effect.scoped` (K-A3, 2026-09-26) — `mintTalosconfig` contributes `Scope.Scope`
 *   to its own return type rather than closing its scope internally (the C1 fix, credentials.ts's
 *   own header); both `read` and `reconcile` call this one function, so wrapping it here covers
 *   both callers.
 * ⛔ I1 FIX (LAND red team, 2026-09-26) — `--nodes` NAMES ONE CONTACT NODE, NOT THE WHOLE CLUSTER.
 *   MEASURED against local talosctl v1.13.8 (unroutable TEST-NET addresses): `talosctl health
 *   --nodes <ip1>,<ip2>` fails with `command "health" is not supported with multiple nodes` — the
 *   shipped code passed EVERY control-plane node as `--nodes`, so with decision 66's 3-node layout
 *   this command could never succeed even against a genuinely healthy cluster: `read` always
 *   reported `healthy:false`, `diff` always planned `update`, and `reconcile` always failed with a
 *   misleading "not healthy within Nm". Fixed: the first control-plane node is the sole `--nodes`/
 *   `--endpoints` contact point (talosctl proxies the actual check through it); the FULL node lists
 *   still go to `--control-plane-nodes`/`--worker-nodes` via `healthArgs`, which is what `talosctl
 *   health` actually checks the health OF.
 */
const check = (props: ClusterHealthProps, waitTimeout: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const credential = yield* mintTalosconfig(props.target);
      const contact = props.controlPlaneNodes[0];
      if (contact === undefined) {
        return yield* Effect.fail(
          new Error(
            `Talos.ClusterHealth ${props.target.cluster}: controlPlaneNodes is empty — need at ` +
              'least one node to contact.',
          ),
        );
      }
      yield* talosctl(healthArgs(props, waitTimeout), {
        endpoints: [contact],
        nodes: [contact],
        talosconfigPath: credential.talosconfigPath,
      });
      return {
        controlPlaneNodes: nodeCsv(props.controlPlaneNodes),
        healthy: true,
        workerNodes: nodeCsv(props.workerNodes),
      };
    }),
  );

/**
 * ⛔ CATCHES ONLY `TalosError` (K-talos-first-boot) — a run of `talosctl health` that itself
 *   completed and exited non-zero, which is the only outcome this family may honestly call "not
 *   healthy yet". Anything else (a `mintTalosconfig`/`bao` failure, a JS defect) propagates instead
 *   of masquerading as an unhealthy cluster — see this file's own header.
 */
const isTalosError = (cause: unknown): cause is TalosError => cause instanceof TalosError;

/** ★ EXPORTED for talos-cluster-health.test.ts — see talos-bootstrap.ts's own note on the pattern. */
export const readClusterHealth = (props: ClusterHealthProps) =>
  check(props, '5s').pipe(
    Effect.catchIf(isTalosError, () =>
      Effect.succeed({
        controlPlaneNodes: nodeCsv(props.controlPlaneNodes),
        healthy: false,
        workerNodes: nodeCsv(props.workerNodes),
      }),
    ),
  );

export const diffClusterHealth = (
  news: Input<ClusterHealthProps>,
  output: ClusterHealthAttributes | undefined,
) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    const live = yield* readClusterHealth(news);
    if (live.healthy) return { action: 'noop' } as const;
    return { action: 'update' } as const;
  });

export const reconcileClusterHealth = (props: ClusterHealthProps) =>
  check(props, props.waitTimeout ?? '20m0s').pipe(
    Effect.catchIf(isTalosError, (cause) =>
      Effect.fail(
        new Error(
          `Talos.ClusterHealth ${props.target.cluster}: cluster not healthy within ` +
            `${props.waitTimeout ?? '20m0s'} — ${String(cause)}`,
        ),
      ),
    ),
  );

const handlers = {
  delete: () => Effect.void,
  diff: ({
    news,
    output,
  }: {
    news: Input<ClusterHealthProps>;
    output: ClusterHealthAttributes | undefined;
  }) => diffClusterHealth(news, output),
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: ClusterHealthProps }) => readClusterHealth(olds),
  reconcile: ({ news }: { news: ClusterHealthProps }) => reconcileClusterHealth(news),
};

export const TalosClusterHealthProvider = () =>
  Provider.effect(TalosClusterHealth, Effect.succeed(TalosClusterHealth.Provider.of(handlers)));
