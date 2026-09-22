/**
 * What makes a `Proxmox.Lxc` a DIFFERENT guest: a new vmid, or another template. Judged by `diff`
 * and `reconcile` in lxc.ts before anything else, and never planned as a replace — see lxc.ts.
 */
import type { LxcAttributes, LxcProps } from './lxc-props.ts';

/** A prop's value if it is already plain data, else undefined (an unresolved Output). */
const plain = (news: unknown, key: string): unknown => {
  const value: unknown = (news as Record<string, unknown>)[key];
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
};

/**
 * ⛔ IDENTITY IS JUDGED BEFORE `isResolved(news)`. That guard returns early when ANY prop is still
 *   an Output, and the engine then plans `update` — which, for a new vmid, would build a second
 *   guest and orphan the first (the openbao rename lesson, rename.ts). A template is identity
 *   too: it is consumed at create, so a different one is a different guest.
 * ★ `node` IS NOT JUDGED HERE, BECAUSE A NODE CHANGE CAN BE THE DECLARATION CATCHING UP. HA fails
 *   a guest over, or somebody runs `pct migrate`; the guest is on its new node before any line
 *   says so. `readLive` at the declared node settles both cases: the guest is there (follow it,
 *   and re-record state with a write-free update), or it is elsewhere and the read FAILS naming
 *   where — asking to move a guest is a migration, and this resource does not migrate.
 */
export const identityRefusals = (
  news: unknown,
  olds: LxcProps,
  output: LxcAttributes | undefined,
): string[] => {
  const was = output?.vmid ?? olds.vmid;
  const vmid = plain(news, 'vmid');
  const template = plain(news, 'ostemplate');
  const reasons: string[] = [];
  if (vmid !== undefined && vmid !== was) {
    reasons.push(
      `vmid: ${String(was)} -> ${String(vmid)} is a different guest. Declare it as a new ` +
        'resource; this one is retained when its declaration goes.',
    );
  }
  if (template !== undefined && olds.ostemplate !== undefined && template !== olds.ostemplate) {
    reasons.push('ostemplate: a template is consumed at create; another one is a new guest.');
  }
  return reasons;
};
