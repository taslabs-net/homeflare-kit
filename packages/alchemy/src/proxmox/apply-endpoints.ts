/**
 * The two applies, and the vendor endpoints they publish through.
 *
 * ★ AN ACTION ENDPOINT IS STILL WIRED, EVEN THOUGH ITS TABLE IS EMPTY, AND THE REASON IS THE
 *   GENERATOR RATHER THAN THE VALIDATOR. `PUT /nodes/{node}/network` and `PUT /cluster/sdn` take
 *   no body at all — there is nothing for a length or a range to be wrong about — but
 *   `codegen/constraints.ts` RESOLVES every key named in this package against the vendor's own
 *   schema and STOPS when one is absent. So the key buys the thing these two families most need:
 *   a PVE that moves, renames or withdraws the apply fails `bun run check` instead of failing an
 *   `ifreload -a` on three nodes at once.
 * ⚠️ AND THE LOOKUP IS NOT FREE EITHER. `constraintsFor` throws when a key has no table, so a
 *   checkout whose generated tables were never refreshed refuses the apply with the command to
 *   run rather than quietly doing nothing — the same defect `constraint-guard.ts` names.
 *
 * ⛔ NEITHER OF THESE IS A CREATE, AND NEITHER FAMILY HAS A `PveSpec`. Both write their own five
 *   handlers (an apply is not an object — see the ⛔ in each file), so they reach the shared check
 *   through `guardForm` by name, exactly as `pbs-datastore-endpoint.ts` does.
 */
import type * as Effect from 'effect/Effect';
import { guardForm } from './constraint-guard.ts';
import type { EndpointKey } from './constraints.ts';

/** ⚠️ `{node}` is a path segment, so this really does take no form keys at all. */
export const NETWORK_APPLY_ENDPOINT: EndpointKey = 'pve:PUT /nodes/{node}/network';

/**
 * ⛔ CLUSTER-WIDE. One PUT publishes every staged zone, vnet and subnet on every node; there is no
 *   per-object apply and no pre-apply veto. `sdn-apply.ts` is the whole argument.
 */
export const SDN_APPLY_ENDPOINT: EndpointKey = 'pve:PUT /cluster/sdn';

export const guardNetworkApply: Effect.Effect<void> = guardForm(NETWORK_APPLY_ENDPOINT, {}, true);

export const guardSdnApply: Effect.Effect<void> = guardForm(SDN_APPLY_ENDPOINT, {}, true);
