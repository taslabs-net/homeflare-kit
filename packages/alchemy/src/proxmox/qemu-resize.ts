/** PVE 9.2.11 QEMU resize, already generated as nodes.putNodeQemuResize in the distilled SDK. */
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import type { VmProps } from './qemu-props.ts';
import { QemuDiskResizeRefused, checkLiveDiskSizes, diskBytes } from './qemu-size.ts';
import { qemuTask } from './qemu-task.ts';
import { formViolations } from './constraint-guard.ts';

/**
 * ⛔ Called only after the import task completes and its allocated disk is read back.
 * Absolute targets make retries safe; `+60G` would grow again after interrupted state writes.
 * This resource never starts a guest. Its caller can power on only after reconcile returns.
 * SDK failures retain their generated tags; provider refusals are QemuDiskResizeRefused.
 */
export const resizeDisks = (props: VmProps, config: Record<string, string>) =>
  Effect.gen(function* () {
    yield* checkLiveDiskSizes(props, config);
    let changed = false;
    for (const [disk, size] of Object.entries(props.diskSizesGiB ?? {})) {
      if (size === undefined) continue;
      if ((diskBytes(config[disk]) ?? 0) >= size * 1024 ** 3) continue;
      const form = { disk, size: `${size}G` };
      const refused = formViolations('pve:PUT /nodes/{node}/qemu/{vmid}/resize', form, true);
      if (refused.length > 0) {
        return yield* Effect.fail(new QemuDiskResizeRefused({ disk, message: refused.join('\n') }));
      }
      yield* qemuTask(
        props,
        nodes.putNodeQemuResize({
          node: props.node,
          vmid: String(props.vmid),
          ...form,
        }),
        `resize VM ${props.vmid} ${disk} to ${size} GiB`,
        60,
      );
      changed = true;
    }
    return changed;
  });
