/**
 * `Talos.ClusterHealth` — readiness gate other resources can depend on via `after`.
 *
 * ★ REASONED FROM talosctl health (Talos v1.13 CLI reference): checks Talos services, etcd, and
 *   Kubernetes component health; `--wait-timeout` defaults to 20m0s.
 *
 * ⚠️ PLAN READS USE A SHORT TIMEOUT SO `plan` DOES NOT BLOCK TWENTY MINUTES. Reconcile uses the
 *   declared timeout — that is the deploy gate, not the plan gate.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { mintTalosconfig } from './credentials.ts';
import type { TalosRequirements, WithTarget } from './resource.ts';
import { talosctl } from './talosctl.ts';

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
  /** Bootstrap and kubeconfig should complete before health is enforced. */
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

const check = (props: ClusterHealthProps, waitTimeout: string) =>
  Effect.gen(function* () {
    const credential = yield* mintTalosconfig(props.target);
    yield* talosctl(healthArgs(props, waitTimeout), {
      nodes: [...props.controlPlaneNodes],
      talosconfigPath: credential.talosconfigPath,
    });
    return {
      controlPlaneNodes: nodeCsv(props.controlPlaneNodes),
      healthy: true,
      workerNodes: nodeCsv(props.workerNodes),
    };
  });

const read = (props: ClusterHealthProps) =>
  check(props, '5s').pipe(
    Effect.orElseSucceed(() => ({
      controlPlaneNodes: nodeCsv(props.controlPlaneNodes),
      healthy: false,
      workerNodes: nodeCsv(props.workerNodes),
    })),
  );

const diff = (news: Input<ClusterHealthProps>, output: ClusterHealthAttributes | undefined) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    const live = yield* read(news);
    if (live.healthy) return { action: 'noop' } as const;
    return { action: 'update' } as const;
  });

const reconcile = (props: ClusterHealthProps) =>
  check(props, props.waitTimeout ?? '20m0s').pipe(
    Effect.mapError(
      (cause) =>
        new Error(
          `Talos.ClusterHealth ${props.target.cluster}: cluster not healthy within ` +
            `${props.waitTimeout ?? '20m0s'} — ${String(cause)}`,
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
  }) => diff(news, output),
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: ClusterHealthProps }) => read(olds),
  reconcile: ({ news }: { news: ClusterHealthProps }) => reconcile(news),
};

export const TalosClusterHealthProvider = () =>
  Provider.effect(TalosClusterHealth, Effect.succeed(TalosClusterHealth.Provider.of(handlers)));
