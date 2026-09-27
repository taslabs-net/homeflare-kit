/**
 * `Talos.Bootstrap` — initialize etcd once on ONE control-plane node.
 *
 * ★ REASONED FROM talosctl bootstrap (Talos v1.13 CLI reference): one node aborts the etcd join
 *   loop and forms the initial cluster; other control-plane nodes join after Kubernetes starts on
 *   the bootstrap node. This command must run exactly once per cluster.
 *
 * ⛔ NOT A FACTORY RESOURCE — bootstrap cannot be deleted or updated in place; `delete` is a no-op.
 *
 * ⛔ ONCE MEANS ONCE (K-talos-first-boot, 2026-09-26) — THE SHIPPED SHAPE COULD BOOTSTRAP A SECOND
 *   etcd CLUSTER. The original `isBootstrapped` turned every read failure into `false`
 *   (`Effect.orElseSucceed`), `diff` then planned `update`, and `reconcile` re-ran `talosctl
 *   bootstrap` — Talos's only server-side guard is a non-empty etcd data directory (REASONED,
 *   `v1alpha1_server.go:441`), so a reinstalled or reset bootstrap node re-bootstrapped a fresh,
 *   isolated single-member cluster: split brain. Fixed per
 *   docs/plans/2026-09-26-talos-stack-first-boot.md's "Bootstrap — once means once" section:
 *     - `read` now answers presence/absence correctly instead of always returning a defined
 *       object — `undefined` only from a SUCCESSFUL read that finds no members (cold-start
 *       absence); a failing read propagates its error instead of being reinterpreted as absence.
 *     - `diff` trusts `output.bootstrapped` once it is `true` and reports `noop` without touching
 *       the live cluster at all — confirmation is `reconcile`'s job now, not plan's.
 *     - `reconcile` checks `output?.bootstrapped` FIRST: once true, it NEVER calls `talosctl
 *       bootstrap` again, no matter what a live read says. A live read that fails OR comes back
 *       empty both raise the same `TalosReBootstrapRefused` — re-bootstrap is a human decision.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { mintTalosconfig } from './credentials.ts';
import type { TalosRequirements, WithTarget } from './resource.ts';
import { assertNoLivePeers, isBootstrapped } from './talos-bootstrap-etcd.ts';
import { TalosReBootstrapRefused } from './talos-errors.ts';
import { talosctlOrAlready } from './talosctl.ts';

export interface BootstrapProps extends WithTarget {
  /** The ONE control-plane node that receives `talosctl bootstrap`. */
  node: string;
  /**
   * The OTHER declared control-plane nodes — never `node` itself. Optional, but a multi-control-
   * plane cluster (decision 66: 3, one per TB4 node) SHOULD set it: `reconcileBootstrap`'s CREATE
   * path (I4 fix, LAND red team, 2026-09-26) requires every one of these to show a successful,
   * EMPTY etcd-members read before it will bootstrap `node` — the guard against re-bootstrapping a
   * split-brain second cluster when this row's own state was lost. See talos-bootstrap-etcd.ts's
   * `assertNoLivePeers`.
   */
  peers?: readonly string[];
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
 * ⛔ WRAPPED IN `Effect.scoped` (K-A3, 2026-09-26) — `mintTalosconfig` contributes `Scope.Scope`
 *   to its own return type rather than closing its scope internally (the C1 fix, credentials.ts's
 *   own header); this is the caller that owns the temp talosconfig's lifetime for the read.
 *
 * ⛔ ANSWERS PRESENCE/ABSENCE, NOT "attrs-or-error" (K-talos-first-boot, fixes the shipped shape).
 *   `undefined` only when a read SUCCEEDS and finds no members — the honest "not created yet"
 *   Alchemy's engine expects from a cold-start adoption probe. A failing read propagates instead
 *   of being reinterpreted as absence — this is the fix `isBootstrapped` no longer hides.
 *
 * ★ EXPORTED (like proxmox/ceph-daemon.ts's `reconcileDaemon`, machine-config-read.ts's
 *   `readMachineConfig`) so talos-bootstrap.test.ts calls it directly with a fake spawner instead
 *   of driving it through the full Alchemy engine.
 */
export const readBootstrap = (props: BootstrapProps) =>
  Effect.scoped(
    Effect.gen(function* () {
      const credential = yield* mintTalosconfig(props.target);
      const bootstrapped = yield* isBootstrapped(props, credential.talosconfigPath);
      return bootstrapped ? ({ bootstrapped: true, node: props.node } as const) : undefined;
    }),
  );

/**
 * ⛔ TRUSTS STATE, NEVER TOUCHES THE LIVE CLUSTER (K-talos-first-boot) — once `output.bootstrapped`
 *   is `true` this always reports `noop`, unconditionally, with zero live calls.
 *
 * ⛔ I3 CORRECTION (LAND red team, 2026-09-26) — THE OLD COMMENT HERE CLAIMED "confirming the
 *   invariant against etcd is reconcile's job (every deploy calls it)". THAT IS FALSE, VERIFIED
 *   against the pinned alchemy beta.79 source: Apply never reconciles a node whose diff came back
 *   `noop` (`Apply.ts`'s `noop` branch just refreshes row metadata and signals ready — it does not
 *   call `provider.reconcile` at all). This file's own `noop` above IS what skips it. So
 *   `reconcileBootstrap`'s re-confirm branch (the one that raises `TalosReBootstrapRefused` on a
 *   failed or empty read) never runs on an ordinary `plan`/`deploy` once `bootstrapped: true` is
 *   recorded — only `--force` reaches it, by forcing a reconcile regardless of the plan action.
 *   Safety still holds — `talosctl bootstrap` genuinely never re-runs while state exists — but a
 *   reset control-plane node (etcd wiped, VM replaced) stays silently invisible to `plan` and
 *   `deploy` alike until an operator runs `--force` or a verify pass.
 *   ⚠️ NOT FIXED BY HAVING `diff` READ HERE TOO (the finding's other offered fix) — that would touch
 *   the live cluster (and mint a talosconfig) on EVERY plan for an already-bootstrapped node, for a
 *   scenario (a reset node) that a `configDigest`-style pinned check can't distinguish from a merely
 *   slow/unreachable read; a single transient failure would then abort every future plan for a
 *   healthy node, for no benefit — the exact cost the original (correct) half of this comment
 *   already named. `MachineConfig`/`ClusterHealth`'s diffs DO mint and read live on every plan
 *   (D2 puts that on the admin/operator lane, not agent), so this isn't a lane-access limit; it is
 *   this resource's own choice to trust a `true` boolean forever rather than re-derive it from a
 *   live signal that cannot yet tell "reset" apart from "briefly unreachable". Recorded as an open
 *   gap for whoever builds the operator verify pass, not silently fixed here.
 */
export const diffBootstrap = (
  news: Input<BootstrapProps>,
  output: BootstrapAttributes | undefined,
) =>
  Effect.gen(function* () {
    if (output === undefined || !isResolved(news)) return undefined;
    if (output.bootstrapped) return { action: 'noop' } as const;
    const live = yield* readBootstrap(news);
    return live?.bootstrapped === true
      ? ({ action: 'noop' } as const)
      : ({ action: 'update' } as const);
  });

/**
 * ⛔ ONCE MEANS ONCE — see this file's own header. `output?.bootstrapped === true` is checked
 *   BEFORE anything else, and that branch never builds a `talosctl bootstrap` argv at all — the
 *   confirmation read below can fail, or succeed and say "absent", and EITHER way this raises
 *   `TalosReBootstrapRefused` rather than treating "absent" as licence to bootstrap again.
 */
export const reconcileBootstrap = (
  props: BootstrapProps,
  output: BootstrapAttributes | undefined,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const credential = yield* mintTalosconfig(props.target);

      if (output?.bootstrapped === true) {
        const stillBootstrapped = yield* isBootstrapped(props, credential.talosconfigPath).pipe(
          Effect.catchIf(
            (): boolean => true,
            (cause) =>
              Effect.fail(
                new TalosReBootstrapRefused({
                  detail: `live read failed: ${String(cause)}`,
                  node: props.node,
                }),
              ),
          ),
        );
        if (!stillBootstrapped) {
          return yield* Effect.fail(
            new TalosReBootstrapRefused({
              detail: 'etcd members are absent on a live read against already-bootstrapped state',
              node: props.node,
            }),
          );
        }
        return { bootstrapped: true, node: props.node };
      }

      const before = yield* isBootstrapped(props, credential.talosconfigPath);
      if (!before) {
        // ⛔ I4 FIX (LAND red team) — see BootstrapProps.peers's own doc and
        // talos-bootstrap-etcd.ts's assertNoLivePeers header.
        yield* assertNoLivePeers(props, credential.talosconfigPath);
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
    }),
  );

const handlers = {
  delete: () => Effect.void,
  diff: ({
    news,
    output,
  }: {
    news: Input<BootstrapProps>;
    output: BootstrapAttributes | undefined;
  }) => diffBootstrap(news, output),
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: BootstrapProps }) => readBootstrap(olds),
  reconcile: ({
    news,
    output,
  }: {
    news: BootstrapProps;
    output: BootstrapAttributes | undefined;
  }) => reconcileBootstrap(news, output),
};

export const TalosBootstrapProvider = () =>
  Provider.effect(TalosBootstrap, Effect.succeed(TalosBootstrap.Provider.of(handlers)));
