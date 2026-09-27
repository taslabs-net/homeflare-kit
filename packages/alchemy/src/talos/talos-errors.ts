/**
 * `Talos.MachineConfig`'s typed failures — split out of talos-machine-config.ts (2026-09-26,
 * K-A3) for the same reason proxmox/credential-errors.ts gives: keep a class's own header out of
 * the 250-line budget of the file that raises it.
 */
import * as Data from 'effect/Data';
import type { ApplyMode } from './resource.ts';

/**
 * The OpenBao KV content at `mount/key` does not hash to the pinned `configDigest`.
 *
 * ★ FAIL CLOSED, NO SPAWN — docs/plans/2026-09-26-talos-secrets-flow.md's O-A: "a poisoned or
 *   fat-fingered KV write cannot silently reach a node". Raised BEFORE any talosctl process
 *   starts, so a mismatch never sends an unpinned config anywhere — see reconcile() in
 *   talos-machine-config.ts, which checks this ahead of minting the talosconfig credential too.
 * ⛔ NEITHER DIGEST IN THIS MESSAGE IS THE CONFIG. Both are sha256 hex digests — safe to log,
 *   safe to persist — never the KV content itself.
 */
export class TalosConfigDigestMismatch extends Data.TaggedError('TalosConfigDigestMismatch')<{
  readonly mount: string;
  readonly key: string;
  readonly expected: string;
  readonly got: string;
}> {
  override get message(): string {
    return (
      `${this.mount}/${this.key}: live content digest ${this.got} does not match the pinned ` +
      `configDigest ${this.expected}. Fail closed — nothing was sent to talosctl. Either the KV ` +
      'value was rewritten without a matching PR, or the pinned digest is stale; check which one ' +
      'moved before re-pinning either side.'
    );
  }
}

/**
 * `apply-config` returned success but the live machineconfig digest never matched the pin within
 * the bounded poll (machine-config-poll.ts). See
 * docs/plans/2026-09-26-talos-stack-first-boot.md's "Converged" section.
 *
 * ⛔ THIS IS THE REPLACEMENT FOR A SILENT `converged: false`. The shipped code let a read
 *   failure during convergence checking disguise itself as "not converged yet" forever
 *   (`orElseSucceed`); this type makes cap expiry a refusal an operator sees, not a plan that
 *   quietly retries the same apply on every future run.
 */
export class TalosConvergenceTimeout extends Data.TaggedError('TalosConvergenceTimeout')<{
  readonly node: string;
  readonly mode: ApplyMode;
  readonly attempts: number;
}> {
  override get message(): string {
    return (
      `${this.node}: apply-config (--mode ${this.mode}) was accepted but the live machineconfig ` +
      `digest never matched the pin within ${this.attempts} bounded poll attempts. Refusing to ` +
      'report converged — hand this node to the operator rather than silently pass.'
    );
  }
}

/**
 * `Talos.Bootstrap` reconcile found state already recording `bootstrapped: true`, and a live
 * check against etcd could not reconfirm it — either the read itself failed (`detail` carries the
 * propagated cause), or it succeeded and came back with no members.
 *
 * ★ K-talos-first-boot's "once means once" — docs/plans/2026-09-26-talos-stack-first-boot.md's own
 *   section of that name. EITHER cause raises this SAME typed error, and both ways `talosctl
 *   bootstrap` is never spawned a second time: re-running it against a node that lost its etcd
 *   data (a VM replace, a reset) forms a second, isolated single-member etcd cluster instead of
 *   rejoining the existing one (REASONED, `v1alpha1_server.go:441` — Talos's only server-side
 *   guard is a non-empty data directory, not "did this cluster already bootstrap"). That is split
 *   brain, and nothing here can tell a genuinely reset node (needs its own operator-run recovery)
 *   apart from a merely slow or unreachable read (needs a retry) — so both refuse alike and hand
 *   the node to a human instead of guessing.
 */
export class TalosReBootstrapRefused extends Data.TaggedError('TalosReBootstrapRefused')<{
  readonly node: string;
  readonly detail: string;
}> {
  override get message(): string {
    return (
      `${this.node}: state already recorded a successful bootstrap, and a live check could not ` +
      `reconfirm it (${this.detail}). Refusing to run 'talosctl bootstrap' again — that risks a ` +
      'second, isolated etcd cluster on a reset node. This needs an operator, not a reconcile.'
    );
  }
}
