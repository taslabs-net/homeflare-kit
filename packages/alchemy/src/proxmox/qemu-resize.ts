/** PVE 9.2.11 QEMU resize, already generated as nodes.putNodeQemuResize in the distilled SDK. */
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import { type VmProps, storedConfig } from './qemu-props.ts';
import { readVm } from './qemu-read.ts';
import { QemuDiskResizeRefused, checkLiveDiskSizes, diskBytes } from './qemu-size.ts';
import { qemuTask } from './qemu-task.ts';
import { formViolations } from './constraint-guard.ts';

const RESIZE_POLLS = 60;

/**
 * ⛔ Recovery can reach here while a timed-out import still holds `lock`. Read the raw
 * config: storedConfig intentionally drops it. Lock waits and task polls share one budget.
 * Never skip/unset a lock; PVE also checks it if another worker races this observation.
 */
const unlockedConfig = (props: VmProps, disk: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; ; attempt++) {
      const live = yield* readVm(props);
      if (live === undefined)
        return yield* Effect.fail(
          new QemuDiskResizeRefused({ disk, message: 'VM disappeared before resize' }),
        );
      if (live.lock === undefined)
        return {
          config: storedConfig(live as unknown as Record<string, unknown>),
          polls: RESIZE_POLLS - attempt,
        };
      if (attempt === RESIZE_POLLS - 1)
        return yield* Effect.fail(
          new QemuDiskResizeRefused({
            disk,
            message: `${disk}: VM ${props.vmid} remains locked (${live.lock}) after ${RESIZE_POLLS} observations; refusing resize`,
          }),
        );
      yield* Effect.sleep('1 second');
    }
  });

/**
 * ⛔ Observe the unlocked, allocated disk before each resize, including recovery after import.
 * Absolute targets make retries safe; `+60G` would grow again after interrupted state writes.
 * This resource never starts a guest. Its caller can power on only after reconcile returns.
 * SDK failures retain their generated tags; provider refusals are QemuDiskResizeRefused.
 */
export const resizeDisks = (props: VmProps) =>
  Effect.gen(function* () {
    for (const [disk, size] of Object.entries(props.diskSizesGiB ?? {})) {
      if (size === undefined) continue;
      const { config, polls } = yield* unlockedConfig(props, disk);
      yield* checkLiveDiskSizes(props, config);
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
        polls,
      );
    }
  });
