/**
 * `Talos.MachineConfig` — apply one machine configuration document to one node.
 *
 * ★ REASONED FROM talosctl apply-config (Talos v1.13 CLI reference): `-f/--file`, `-n/--nodes`,
 *   `-m/--mode`, `-i/--insecure` for maintenance mode, `--dry-run` for planning without a write.
 *
 * ⛔ THE CONFIG BODY IS NEVER AN ATTRIBUTE. Machine configs can embed cluster tokens; only a digest
 *   of the repo file is persisted. Read `configFile` from disk at reconcile time.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { mintTalosconfig } from './credentials.ts';
import type { TalosRequirements, WithTarget } from './resource.ts';
import { talosctl } from './talosctl.ts';
import { configDigest, resolveConfigPath } from './values.ts';

const STACK_DIR = new URL('..', import.meta.url).pathname;

export type ApplyMode = 'auto' | 'no-reboot' | 'reboot' | 'staged' | 'try';

export interface MachineConfigProps extends WithTarget {
  /** Node IP or hostname — the `-n` target. */
  node: string;
  /** Repo-relative or absolute path to the YAML file passed to `-f`. */
  configFile: string;
  /** talosctl `-m` mode. Default `auto` per published CLI. */
  mode?: ApplyMode;
  /**
   * Maintenance-mode apply only (`-i`). Default false — post-bootstrap applies use talosconfig auth.
   *
   * ⚠️ REASONED: docs describe `--insecure` for the first apply before talosconfig exists.
   */
  insecure?: boolean;
  /** Ordering edge — e.g. wait for Proxmox.Vm. */
  after?: readonly unknown[];
}

export interface MachineConfigAttributes {
  node: string;
  configDigest: string;
  mode: ApplyMode;
  /** True when the node's reported config digest matches the declared file. */
  converged: boolean;
}

export interface TalosMachineConfig extends Resource<
  'Talos.MachineConfig',
  MachineConfigProps,
  MachineConfigAttributes,
  never,
  TalosRequirements
> {}

export const TalosMachineConfig = Resource<TalosMachineConfig>('Talos.MachineConfig');

const loadDigest = (props: MachineConfigProps) =>
  Effect.gen(function* () {
    const path = resolveConfigPath(STACK_DIR, props.configFile);
    const text = yield* Effect.tryPromise({
      try: () => Bun.file(path).text(),
      catch: (cause) => new Error(`reading ${props.configFile}: ${String(cause)}`),
    });
    return configDigest(text);
  });

/** REASONED: `talosctl get machineconfig -o yaml` returns the live document. */
const liveDigest = (props: MachineConfigProps, talosconfigPath: string) =>
  talosctl(['get', 'machineconfig', '-o', 'yaml'], {
    nodes: [props.node],
    talosconfigPath,
  }).pipe(
    Effect.map((yaml) => configDigest(yaml)),
    Effect.orElseSucceed(() => undefined),
  );

const read = (props: MachineConfigProps) =>
  Effect.gen(function* () {
    const wanted = yield* loadDigest(props);
    const credential = yield* mintTalosconfig(props.target);
    const live = yield* liveDigest(props, credential.talosconfigPath);
    return {
      configDigest: wanted,
      converged: live === wanted,
      mode: props.mode ?? 'auto',
      node: props.node,
    };
  });

const diff = (news: Input<MachineConfigProps>, output: MachineConfigAttributes | undefined) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    const live = yield* read(news);
    if (live.converged) return { action: 'noop' } as const;
    return { action: 'update' } as const;
  });

const reconcile = (props: MachineConfigProps) =>
  Effect.gen(function* () {
    const path = resolveConfigPath(STACK_DIR, props.configFile);
    const wanted = yield* loadDigest(props);
    const credential = yield* mintTalosconfig(props.target);
    const args = [
      'apply-config',
      '--file',
      path,
      '--mode',
      props.mode ?? 'auto',
      ...(props.insecure === true ? ['--insecure'] : []),
    ];
    yield* talosctl(args, { nodes: [props.node], talosconfigPath: credential.talosconfigPath });
    const live = yield* liveDigest(props, credential.talosconfigPath);
    if (live !== wanted) {
      return yield* Effect.die(
        new Error(
          `${props.node}: apply-config returned no error but machineconfig digest still differs. ` +
            'Read back rather than trusting the exit code alone.',
        ),
      );
    }
    return {
      configDigest: wanted,
      converged: true,
      mode: props.mode ?? 'auto',
      node: props.node,
    };
  });

const handlers = {
  delete: () => Effect.void,
  diff: ({
    news,
    output,
  }: {
    news: Input<MachineConfigProps>;
    output: MachineConfigAttributes | undefined;
  }) => diff(news, output),
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: MachineConfigProps }) => read(olds),
  reconcile: ({ news }: { news: MachineConfigProps }) => reconcile(news),
};

export const TalosMachineConfigProvider = () =>
  Provider.effect(TalosMachineConfig, Effect.succeed(TalosMachineConfig.Provider.of(handlers)));
