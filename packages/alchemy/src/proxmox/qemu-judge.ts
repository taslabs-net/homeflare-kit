/**
 * Declared against live: what a `Proxmox.Vm` deploy would write, per key — the QEMU sibling of
 * lxc-judge.ts, added 2026-09-26 (red-team C1/I1 on PR 297).
 *
 * ⛔ REPLACES A WHOLE-STRING, WHOLE-FORM COMPARISON. Before this, `matches` compared each declared
 *   key to live BYTE FOR BYTE and, on any drift, `formToSend` re-PUT every declared key at once
 *   (qemu-lifecycle.ts). A `scsi0`/`ide2`/`net0` declared in the "new" or MAC-less spelling then
 *   NEVER matched its own live volume/NIC (qemu-volume.ts / qemu-net.ts explain why), so every
 *   deploy re-sent all three -- reallocating the disk, re-importing it, and handing out a fresh MAC
 *   each time, even when nothing else changed. `judge` below decides per key, on the LIVE volume id
 *   and LIVE MAC, so an unrelated field's drift no longer drags the disk/NIC keys along with it.
 */
import { type VmProps, declaredKeys, declaredValue, indexedKey, wireValue } from './qemu-props.ts';
import { judgeDisk } from './qemu-volume.ts';
import { netWrite, sameNet } from './qemu-net.ts';
import { diskSizeDrift } from './qemu-size.ts';

export type VmChange = {
  /** Keys to `PUT …/config`, wire-spelled and built on live ids where one exists. */
  readonly put: Record<string, string>;
  /** Why a key cannot be written as an update. Non-empty means nothing is written. */
  readonly refuse: readonly string[];
  /** Every declared key that differs from live, refused or not. */
  readonly drift: readonly string[];
};

export const judge = (props: VmProps, config: Record<string, string>): VmChange => {
  const put: Record<string, string> = {};
  const refuse: string[] = [];
  const drift = new Set<string>(diskSizeDrift(props, config));

  for (const key of declaredKeys(props)) {
    const want = wireValue(declaredValue(props, key));
    const have = config[key];
    const family = indexedKey(key)?.[0];

    if (family === 'scsi' || family === 'ide') {
      if (have === undefined) {
        drift.add(key);
        put[key] = want;
      } else {
        const verdict = judgeDisk(key, want, have);
        if (verdict.refuse !== undefined) {
          drift.add(key);
          refuse.push(verdict.refuse);
        } else if (verdict.put !== undefined) {
          drift.add(key);
          put[key] = verdict.put;
        }
      }
      continue;
    }

    if (family === 'net') {
      if (have === undefined) {
        drift.add(key);
        put[key] = want;
      } else if (!sameNet(want, have)) {
        drift.add(key);
        put[key] = netWrite(want, have);
      }
      continue;
    }

    // Scalars, `ipconfigN`, `serialN`: a plain string compare, as the old whole-form model did.
    // ⚠️ No "new spelling" or MAC ambiguity applies to these -- see qemu-props.ts's own doc per key.
    if (want !== (have ?? '')) {
      drift.add(key);
      put[key] = want;
    }
  }
  return { drift: [...drift].sort(), put, refuse };
};

/**
 * What makes a `Proxmox.Vm` a DIFFERENT machine: a new vmid (red-team I1). Never planned as a
 * replace -- see qemu.ts's header on why nothing here replaces a running VM.
 * ⚠️ `was` PREFERS THE RECORDED ATTRIBUTE, so a `node` change (HA failover, a hand `qm migrate`)
 *   never reads as a vmid change: only `vmid` is judged here, mirroring lxc-identity.ts.
 */
export const identityRefusal = (vmid: number, was: number | undefined): string | undefined =>
  was === undefined || vmid === was
    ? undefined
    : `vmid: ${String(was)} -> ${String(vmid)} is a different VM. Declare it as a new resource; ` +
      'this one is retained when its declaration goes.';
