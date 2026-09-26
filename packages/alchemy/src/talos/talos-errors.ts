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
