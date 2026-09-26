/**
 * `Talos.MachineConfig` — apply one machine configuration document to one node.
 *
 * ★ REASONED FROM talosctl apply-config (Talos v1.13 CLI reference): `-f/--file`, `-n/--nodes`,
 *   `-m/--mode`, `-i/--insecure` for maintenance mode.
 *
 * ⛔ THE CONFIG BODY IS NEVER AN ATTRIBUTE, A PROP, OR ARGV — ONLY ITS DIGEST. K-A3
 *   (docs/plans/2026-09-26-talos-secrets-flow.md, option O-A) moved the source of truth from a
 *   repo file (the shipped `configFile` + `STACK_DIR`, gone with this rewrite) to OpenBao: props
 *   carry a `configKey` (a vault path) and a `configDigest` PINNED IN GIT, never the bytes. The
 *   source is write-only from Alchemy's point of view — content is read once per reconcile,
 *   verified against the pin, written to a session-temp file, and never returned from any
 *   handler.
 * ⛔ NEVER `--dry-run`. Talos's dry-run prints a full, unredacted old/new config diff — with an
 *   empty old config (the first apply) that diff IS the whole config, CA private key and
 *   bootstrap token included (REASONED, `internal/app/machined/.../v1alpha1_server.go:258-272` +
 *   `configdiff.go`; docs/plans/2026-09-26-talos-stack-first-boot.md). This file never builds
 *   that flag.
 * ⛔ `insecure` IS NOT A PROP. A fixed value fails in both directions — `true` breaks every later
 *   update, `false` breaks the very first apply against a node with no talosconfig auth yet — so
 *   CREATE (`output === undefined`) applies `--insecure` and UPDATE never does (resource.ts).
 */
import { Resource } from 'alchemy';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { mintKvTempFile, mintTalosconfig, readKvValue } from './credentials.ts';
import { diffMachineConfig, liveSpecDigest, readMachineConfig } from './machine-config-read.ts';
import { type PollPolicy, confirmConverged } from './machine-config-poll.ts';
import type { ApplyMode, TalosRequirements, WithTarget } from './resource.ts';
import { TalosConfigDigestMismatch } from './talos-errors.ts';
import { talosctl } from './talosctl.ts';
import { configDigest } from './values.ts';

export type { ApplyMode } from './resource.ts';

export interface MachineConfigProps extends WithTarget {
  /** Node IP or hostname — the `-n` target. */
  node: string;
  /** OpenBao KV path under `target.mount` holding this node's rendered config, e.g. `nodes/10001`. */
  configKey: string;
  /**
   * sha256(canonicalText(content)) of the seeded KV value (values.ts `configDigest`), pinned in
   * git by the operator. ⛔ Verified against the live KV content before ANY talosctl spawn — a
   * mismatch fails closed (`TalosConfigDigestMismatch`), nothing is applied.
   */
  configDigest: string;
  /** talosctl `-m` mode. Default `auto` per published CLI. */
  mode?: ApplyMode;
  /** Ordering edge — e.g. wait for Proxmox.Vm. */
  after?: readonly unknown[];
}

export interface MachineConfigAttributes {
  node: string;
  configDigest: string;
  mode: ApplyMode;
  /**
   * Which convergence claim was made. `'read-back'`/`'accepted'` only come from `reconcile` (see
   * machine-config-poll.ts); `false` only comes from `read`, meaning a live digest was
   * successfully fetched and genuinely differs — never a stand-in for a failed read, which
   * propagates as its own error instead (docs/plans/2026-09-26-talos-stack-first-boot.md).
   */
  converged: 'read-back' | 'accepted' | false;
}

export interface TalosMachineConfig extends Resource<
  'Talos.MachineConfig',
  MachineConfigProps,
  MachineConfigAttributes,
  never,
  TalosRequirements
> {}

export const TalosMachineConfig = Resource<TalosMachineConfig>('Talos.MachineConfig');

/**
 * The read path (`readMachineConfig`, `diffMachineConfig`, `liveSpecDigest`) lives in
 * machine-config-read.ts — see that file's own header for the ownership-aware three-way answer
 * `read` now gives (fix-first #1/#2, PR 307 red team).
 */

/** `pollPolicies` is a test seam only — see machine-config-poll.ts's `confirmConverged`. */
export const reconcileMachineConfig = (
  props: MachineConfigProps,
  output: MachineConfigAttributes | undefined,
  pollPolicies?: { readonly immediate: PollPolicy; readonly rebootish: PollPolicy },
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const mode = props.mode ?? 'auto';

      // ⛔ VERIFY BEFORE ANY talosctl SPAWN. A mismatch fails closed — see talos-errors.ts.
      const raw = yield* readKvValue(props.target.mount, props.configKey, ['config']);
      const gotDigest = configDigest(raw);
      if (gotDigest !== props.configDigest) {
        return yield* Effect.fail(
          new TalosConfigDigestMismatch({
            expected: props.configDigest,
            got: gotDigest,
            key: props.configKey,
            mount: props.target.mount,
          }),
        );
      }

      const credential = yield* mintTalosconfig(props.target);
      const { path } = yield* mintKvTempFile(raw, `${props.target.cluster}-${props.node}-config`);

      const isCreate = output === undefined;
      const args = [
        'apply-config',
        '--file',
        path,
        '--mode',
        mode,
        ...(isCreate ? ['--insecure'] : []),
      ];
      yield* talosctl(args, { nodes: [props.node], talosconfigPath: credential.talosconfigPath });

      const converged = yield* confirmConverged(
        props.node,
        mode,
        liveSpecDigest(props, credential.talosconfigPath).pipe(
          Effect.map((live) => live === props.configDigest),
        ),
        pollPolicies,
      );

      return {
        configDigest: props.configDigest,
        converged,
        mode,
        node: props.node,
      } satisfies MachineConfigAttributes;
    }),
  );

const handlers = {
  delete: () => Effect.void,
  diff: ({
    news,
    output,
  }: {
    news: Input<MachineConfigProps>;
    output: MachineConfigAttributes | undefined;
  }) => diffMachineConfig(news, output),
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: MachineConfigProps }) => readMachineConfig(olds),
  reconcile: ({
    news,
    output,
  }: {
    news: MachineConfigProps;
    output: MachineConfigAttributes | undefined;
  }) => reconcileMachineConfig(news, output),
};

export const TalosMachineConfigProvider = () =>
  Provider.effect(TalosMachineConfig, Effect.succeed(TalosMachineConfig.Provider.of(handlers)));
