/**
 * Every generated NetBox constraint table, merged — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/netbox.ts
 *
 * ⚠️ EVERY KEY IS PREFIXED `netbox:` FOR THE SAME REASON THE PROXMOX TABLES ARE PREFIXED. One
 *   estate runs several vendors and the reader is shared; an unprefixed `POST /api/…` would be
 *   one vendor away from colliding.
 */
import type { EndpointConstraints } from '../../constraints.ts';
import { NETBOX_IPAM_CONSTRAINTS } from './netbox-ipam.ts';

export const NETBOX_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  ...NETBOX_IPAM_CONSTRAINTS,
};

/**
 * sha256 of the merged table, truncated.
 *
 * ★ A DIGEST OF THE DATA, NOT OF THE FILE TEXT, so reformatting is not a stale generation while
 *   changing a 200 to a 201 by hand is. `tests/netbox-manifest.test.ts` recomputes it.
 */
export const NETBOX_CONSTRAINTS_DIGEST = '1de1cebe7491d94f';
