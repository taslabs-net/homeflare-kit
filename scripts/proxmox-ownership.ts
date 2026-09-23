/**
 * Which vendor endpoint each Proxmox Resource in `@homeflare/alchemy` WRITES TO — both halves,
 * assembled. The rows live in `proxmox-ownership-pve.ts` and `proxmox-ownership-pbs.ts`; what a
 * row MEANS, and why it is hand-written, is in `proxmox-ownership-shape.ts`.
 */
import { PBS_OWNERSHIP } from './proxmox-ownership-pbs.ts';
import { PVE_NODE_OWNERSHIP } from './proxmox-ownership-pve-nodes.ts';
import { PVE_CLUSTER_OWNERSHIP } from './proxmox-ownership-pve.ts';

export type { Claim, Note, Ownership, System } from './proxmox-ownership-shape.ts';

export const OWNERSHIP = [...PVE_CLUSTER_OWNERSHIP, ...PVE_NODE_OWNERSHIP, ...PBS_OWNERSHIP];
