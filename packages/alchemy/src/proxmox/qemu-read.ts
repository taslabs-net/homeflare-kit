/**
 * One QEMU config read, then a cluster-wide vmid check when that file is absent.
 * ⛔ QemuConfigNotFound means the file is missing on THIS node. AbstractConfig raises it
 *   before any other guest type is considered. A vmid is shared with containers, so absence
 *   here is not permission to POST until the same credential's guest index agrees.
 */
import * as cluster from '@distilled.cloud/proxmox/cluster';
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import { runPveWith } from './distilled-pve.ts';
import { leased } from './lease-cache.ts';
import { QemuRefusedError } from './qemu-errors.ts';
import type { VmProps } from './qemu.ts';
import { text } from './values.ts';

const guestTypes = ['lxc', 'qemu'] as const;

export const readVm = (props: VmProps) =>
  Effect.gen(function* () {
    const credential = yield* leased(props.target, 'read');
    const answer = yield* runPveWith(
      props.target,
      credential,
      false,
      nodes.getNodeQemuConfig({ node: props.node, vmid: String(props.vmid) }),
    ).pipe(
      Effect.map((data) => ({ data, error: undefined })),
      Effect.catchTag('QemuConfigNotFound', (error) => Effect.succeed({ data: undefined, error })),
    );
    if (answer.error === undefined) {
      const live = answer.data;
      // ⛔ The vendor requires digest. Null or an empty object is not absence.
      if (typeof live.digest !== 'string' || live.digest === '') {
        return yield* Effect.fail(
          new QemuRefusedError(
            `VM ${String(props.vmid)}: config read did not return a digest-bearing config.`,
          ),
        );
      }
      return live;
    }
    const rows = yield* runPveWith(
      props.target,
      credential,
      false,
      cluster.listClusterResources({ type: 'vm' }),
    );
    if (
      !Array.isArray(rows) ||
      rows.some(
        (row) =>
          !Number.isSafeInteger(Number(row?.vmid)) ||
          Number(row?.vmid) <= 0 ||
          typeof row?.node !== 'string' ||
          row.node === '' ||
          !guestTypes.includes(row.type as (typeof guestTypes)[number]),
      )
    ) {
      return yield* Effect.fail(
        new QemuRefusedError('The cluster guest index did not identify its rows.'),
      );
    }
    const found = rows.find((row) => Number(row.vmid) === props.vmid);
    if (found === undefined) return undefined;
    if (found.node === props.node && found.type === 'qemu') return yield* Effect.fail(answer.error);
    return yield* Effect.fail(
      new QemuRefusedError(
        `vmid ${String(props.vmid)} is a ${text(found.type, 'guest')} on ` +
          `${text(found.node, '?')}, not a VM on ${props.node}. A migration is not an ` +
          'update and vmids are cluster-wide: declare the node it is on, or pick a free vmid.',
      ),
    );
  });
