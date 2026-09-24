/**
 * QEMU lifecycle on named operations.
 * ⛔ GET and PUT use `/nodes/{node}/qemu/{vmid}/config`. DELETE uses `/nodes/{node}/qemu/{vmid}`.
 *   qemu-server Qemu.pm names that second route `destroy_vm`. Sending DELETE to the config
 *   route does not destroy the guest.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import { runPve } from './distilled-pve.ts';
import { createForm, shape } from './qemu-form.ts';
import { QemuRefusedError } from './qemu-errors.ts';
import { readVm } from './qemu-read.ts';
import { qemuTask } from './qemu-task.ts';
import type { VmAttributes, VmProps } from './qemu.ts';
import type { PveSpec } from './resource-spec.ts';
import { specGuards } from './resource-guard.ts';
import { formToSend } from './update-guard.ts';
import { int } from './values.ts';

const CREATE_POLLS = 180;
const DELETE_POLLS = 60;

const attributesOf = (
  live: {
    cores?: unknown;
    memory?: unknown;
    name?: unknown;
    onboot?: unknown;
    sockets?: unknown;
  },
  props: VmProps,
): VmAttributes => ({
  cores: int(live.cores, 1),
  memory: int(live.memory, 512),
  name: typeof live.name === 'string' ? live.name : '',
  node: props.node,
  onboot: live.onboot === 1 || live.onboot === true,
  sockets: int(live.sockets, 1),
  vmid: props.vmid,
});

const matches = (attributes: VmAttributes, props: VmProps) =>
  attributes.name === (props.name ?? `vm${String(props.vmid)}`) &&
  attributes.memory === (props.memory ?? 512) &&
  attributes.cores === (props.cores ?? 1) &&
  attributes.sockets === (props.sockets ?? 1) &&
  attributes.onboot === (props.onboot === true);

const spec = {
  attributes: attributesOf,
  collection: (props: VmProps) => `nodes/${props.node}/qemu`,
  createForm,
  endpoint: {
    create: 'pve:POST /nodes/{node}/qemu',
    update: 'pve:PUT /nodes/{node}/qemu/{vmid}/config',
  },
  matches,
  path: (props: VmProps) => `nodes/${props.node}/qemu/${String(props.vmid)}/config`,
  updateForm: shape,
} satisfies PveSpec<VmProps, VmAttributes>;

const { guardCreate, guardUpdate } = specGuards(spec);

export const readQemu = (props: VmProps) =>
  readVm(props).pipe(
    Effect.map((live) => (live === undefined ? undefined : attributesOf(live, props))),
  );

/** No purge, no skiplock, no destroy-unreferenced-disks. A missing config is already gone. */
export const deleteQemu = (props: VmProps) =>
  qemuTask(
    props,
    nodes.deleteNodeQemu({ node: props.node, vmid: String(props.vmid) }),
    `destroy VM ${String(props.vmid)}`,
    DELETE_POLLS,
  ).pipe(Effect.catchTag('QemuConfigNotFound', () => Effect.void));

export const qemuHandlers = {
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: VmProps }) => readQemu(olds),
  diff: Effect.fn(function* ({
    news,
    output,
  }: {
    news: Input<VmProps>;
    output: VmAttributes | undefined;
  }) {
    if (!isResolved(news)) return undefined;
    yield* guardCreate(news, output === undefined);
    yield* guardUpdate(news);
    if (output === undefined) return undefined;
    const live = yield* readQemu(news);
    if (live === undefined) {
      yield* guardCreate(news, true);
      return { action: 'update' } as const;
    }
    return { action: spec.matches(live, news) ? 'noop' : 'update' } as const;
  }),
  reconcile: Effect.fn(function* ({ news }: { news: VmProps }) {
    const live = yield* readQemu(news);
    yield* guardCreate(news, live === undefined);
    yield* guardUpdate(news);
    if (live === undefined) {
      yield* qemuTask(
        news,
        nodes.createNodeQemu({ ...createForm(news), node: news.node }),
        `create VM ${String(news.vmid)}`,
        CREATE_POLLS,
      );
    } else {
      const form = formToSend(spec.matches, live, news, spec.updateForm(news));
      if (form !== undefined) {
        yield* runPve(
          news.target,
          'provision',
          true,
          nodes.putNodeQemuConfig({ ...form, node: news.node, vmid: String(news.vmid) }),
        );
      }
    }
    const after = yield* readQemu(news);
    if (after === undefined) {
      return yield* Effect.fail(
        new QemuRefusedError(
          `${spec.path(news)}: write returned success but the VM is still absent`,
        ),
      );
    }
    return after;
  }),
  delete: ({ olds }: { olds: VmProps }) => deleteQemu(olds),
};
