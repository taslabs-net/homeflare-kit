/**
 * `Talos.Bootstrap` — initialize etcd once on ONE control-plane node.
 *
 * ★ REASONED FROM talosctl bootstrap (Talos v1.13 CLI reference): one node aborts the etcd join
 *   loop and forms the initial cluster; other control-plane nodes join after Kubernetes starts on
 *   the bootstrap node. This command must run exactly once per cluster.
 *
 * ⛔ NOT A FACTORY RESOURCE — bootstrap cannot be deleted or updated in place; `delete` is a no-op.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { mintTalosconfig } from './credentials.ts';
import type { TalosRequirements, WithTarget } from './resource.ts';
import { talosctl, talosctlOrAlready } from './talosctl.ts';

export interface BootstrapProps extends WithTarget {
  /** The ONE control-plane node that receives `talosctl bootstrap`. */
  node: string;
  /** Machine configs for this node (and peers) must be applied first. */
  after?: readonly unknown[];
}

export interface BootstrapAttributes {
  node: string;
  bootstrapped: boolean;
}

export interface TalosBootstrap extends Resource<
  'Talos.Bootstrap',
  BootstrapProps,
  BootstrapAttributes,
  never,
  TalosRequirements
> {}

export const TalosBootstrap = Resource<TalosBootstrap>('Talos.Bootstrap', {
  /** etcd data is irreplaceable — opt into destroy explicitly if Talos ever adds an undo. */
  defaultRemovalPolicy: 'retain',
});

/**
 * REASONED: `talosctl get etcdmembers -o json` should list members after bootstrap.
 * ⚠️ NOT MEASURED — first live deploy confirms the resource type name.
 */
const isBootstrapped = (props: BootstrapProps, talosconfigPath: string) =>
  talosctl(['get', 'etcdmembers', '-o', 'json'], {
    nodes: [props.node],
    talosconfigPath,
  }).pipe(
    Effect.map((text) => text.includes('"id"') || text.includes('"member"')),
    Effect.orElseSucceed(() => false),
  );

const read = (props: BootstrapProps) =>
  Effect.gen(function* () {
    const credential = yield* mintTalosconfig(props.target);
    const bootstrapped = yield* isBootstrapped(props, credential.talosconfigPath);
    return { bootstrapped, node: props.node };
  });

const diff = (news: Input<BootstrapProps>, output: BootstrapAttributes | undefined) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    const live = yield* read(news);
    if (live.bootstrapped) return { action: 'noop' } as const;
    return { action: 'update' } as const;
  });

const reconcile = (props: BootstrapProps) =>
  Effect.gen(function* () {
    const credential = yield* mintTalosconfig(props.target);
    const before = yield* isBootstrapped(props, credential.talosconfigPath);
    if (!before) {
      yield* talosctlOrAlready(['bootstrap'], {
        nodes: [props.node],
        talosconfigPath: credential.talosconfigPath,
      });
    }
    const after = yield* isBootstrapped(props, credential.talosconfigPath);
    if (!after) {
      return yield* Effect.die(
        new Error(
          `${props.node}: bootstrap returned no error but etcd members are still absent. ` +
            'Read back rather than trusting the exit code alone.',
        ),
      );
    }
    return { bootstrapped: true, node: props.node };
  });

const handlers = {
  delete: () => Effect.void,
  diff: ({
    news,
    output,
  }: {
    news: Input<BootstrapProps>;
    output: BootstrapAttributes | undefined;
  }) => diff(news, output),
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: BootstrapProps }) => read(olds),
  reconcile: ({ news }: { news: BootstrapProps }) => reconcile(news),
};

export const TalosBootstrapProvider = () =>
  Provider.effect(TalosBootstrap, Effect.succeed(TalosBootstrap.Provider.of(handlers)));
