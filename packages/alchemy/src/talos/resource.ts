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
import type * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
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
