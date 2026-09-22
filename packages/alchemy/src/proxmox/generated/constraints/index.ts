/**
 * Every generated Proxmox constraint table, merged — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/constraints.ts
 *
 * ⚠️ MERGING IS SAFE ONLY BECAUSE EVERY KEY IS PREFIXED `pve:`/`pbs:`. PVE and PBS both publish
 *   `PUT /access/acl` and `PUT /access/password` with DIFFERENT rules; an unprefixed merge would
 *   silently enforce one product's limits on the other's objects.
 */
import type { EndpointConstraints } from '../../constraints.ts';
import { PVE_ACCESS_CONSTRAINTS } from './pve-access.ts';
import { PVE_CLUSTER_CONSTRAINTS } from './pve-cluster.ts';
import { PVE_POOLS_CONSTRAINTS } from './pve-pools.ts';
import { PVE_STORAGE_CONSTRAINTS } from './pve-storage.ts';
import { PBS_CONFIG_CONSTRAINTS } from './pbs-config.ts';

export const PROXMOX_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  ...PVE_ACCESS_CONSTRAINTS,
  ...PVE_CLUSTER_CONSTRAINTS,
  ...PVE_POOLS_CONSTRAINTS,
  ...PVE_STORAGE_CONSTRAINTS,
  ...PBS_CONFIG_CONSTRAINTS,
};

/**
 * sha256 of the merged table, truncated.
 *
 * ★ A DIGEST OF THE DATA, NOT OF THE FILE TEXT, so reformatting is not a stale generation while
 *   changing a 128 to a 129 by hand is. `tests/schema-manifest.test.ts` recomputes it.
 */
export const PROXMOX_CONSTRAINTS_DIGEST = '687e00e94e121c0e';
