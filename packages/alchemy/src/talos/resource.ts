/**
 * Talos has no REST CRUD factory — and pretending otherwise would lie in every plan.
 *
 * ⛔ THE FORGEJO/PVE FACTORY IS create / read / update / delete OVER ONE JSON OBJECT AT ONE PATH.
 *   Talos machine configuration is `talosctl apply-config`; bootstrap is a one-shot
 *   `talosctl bootstrap`; health is `talosctl health`; kubeconfig is `talosctl kubeconfig`. None
 *   of those are the same four operations with a different path — bootstrap cannot be deleted,
 *   health is a gate not an object, and kubeconfig must not round-trip credential bytes through
 *   Postgres. Copying forgejoOperations here would force `matches` to compare a declaration to
 *   itself and answer `noop` forever, exactly the failure mode documented on Proxmox.NetworkApply.
 *
 * ★ SO EACH FAMILY BELOW HAND-WRITES THE FIVE PROVIDER HANDLERS, LIKE network-apply.ts and
 *   sdn-apply.ts. Shared pieces are credentials.ts (mint) and talosctl.ts (spawn).
 *
 * ⚠️ EVERY CLAIM ABOUT talosctl FLAGS IN THIS PACKAGE IS REASONED FROM THE PUBLISHED CLI REFERENCE
 *   (Talos v1.13 docs, fetched 2026-09-13 in this session). Nothing was measured on a live cluster.
 */
import type * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner';
import type { TalosTarget } from './credentials.ts';

/**
 * ★ WHAT EVERY OPERATION HERE NEEDS FROM THE RUNTIME — ChildProcessSpawner only.
 *
 *   Talos credentials are minted by shelling out to `bao` and then shelling out to `talosctl`.
 *   There is no HttpClient call in this package on purpose: the published operator surface is the
 *   CLI, and a parallel gRPC client would be a second SDK the repo rules forbid.
 */
export type TalosRequirements = ChildProcessSpawner.ChildProcessSpawner;

/** Every resource names which cluster's OpenBao mount it uses. */
export type WithTarget = { target: TalosTarget };

/**
 * `talosctl apply-config -m/--mode`. Lives here, not in talos-machine-config.ts, so
 * talos-errors.ts can name it in `TalosConvergenceTimeout` without importing that file back
 * (machine-config-poll.ts -> talos-errors.ts -> talos-machine-config.ts would cycle).
 *
 * ★ K-A3 DROPPED THE `insecure` PROP THAT USED TO SIT BESIDE THIS TYPE. A fixed `insecure` prop
 *   fails in both directions (`true` breaks every later update, `false` breaks the very first
 *   apply against a node with no talosconfig auth yet), so `Talos.MachineConfig` now derives it
 *   itself: CREATE (`output === undefined`) applies `--insecure`, UPDATE never does.
 * ⛔ `'staged'` AND `'try'` ARE DROPPED (fix-first #2, PR 307 red team). `try` reverts itself after
 *   its timeout, so a bounded poll that later reads the reverted config would see it never match
 *   the pin and re-run `apply-config` on every deploy — the poll would be "confirming" a change
 *   `try` had already undone. `staged` defers the write to the NEXT reboot rather than applying it,
 *   which `isRebootish` (machine-config-poll.ts) cannot honestly claim `'accepted'` for without a
 *   reboot ever happening — the reboot for a staged config is a separate, later operator action
 *   this package does not drive. Both need their own design work, not a poll-policy guess.
 */
export type ApplyMode = 'auto' | 'no-reboot' | 'reboot';
