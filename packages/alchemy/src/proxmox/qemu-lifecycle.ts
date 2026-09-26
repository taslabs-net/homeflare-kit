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
import { createForm, formRefusals, updateForm } from './qemu-form.ts';
import { QemuRefusedError } from './qemu-errors.ts';
import {
  type VmAttributes,
  type VmProps,
  declaredKeys,
  declaredValue,
  isManagedKey,
  storedConfig,
  wireValue,
} from './qemu-props.ts';
import { readVm } from './qemu-read.ts';
import { qemuTask } from './qemu-task.ts';
import type { PveSpec } from './resource-spec.ts';
import { specGuards } from './resource-guard.ts';
import { formToSend } from './update-guard.ts';

const CREATE_POLLS = 180;
const DELETE_POLLS = 60;

const attributesOf = (live: Record<string, unknown>, props: VmProps): VmAttributes => ({
  config: storedConfig(live),
  node: props.node,
  vmid: props.vmid,
});

/**
 * ⛔ DECLARED MANAGED KEYS ONLY — see qemu-props.ts's header for the "5-default PUT" this
 *   replaces. A key the declaration leaves out is unmanaged: it is never compared here, so it can
 *   never be reported as drift or written over.
 */
const matches = (attributes: VmAttributes, props: VmProps) =>
  declaredKeys(props)
    .filter(isManagedKey)
    .every((key) => attributes.config[key] === wireValue(declaredValue(props, key)));

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
  updateForm,
} satisfies PveSpec<VmProps, VmAttributes>;

const { guardCreate, guardUpdate } = specGuards(spec);

export const readQemu = (props: VmProps) =>
  readVm(props).pipe(
    Effect.map((live) =>
      live === undefined
        ? undefined
        : // ⚠️ WIDENED ON PURPOSE. `GetNodeQemuConfigResponse` types only the keys pve-manager's
          //   apidoc names as SCALARS; it cannot express `scsi[n]`/`net[n]`/`ipconfig[n]` at all
          //   (qemu-props.ts's header), so it carries no index signature. `storedConfig` reads
          //   those keys anyway, because the ACTUAL wire response has them (protocol-http.ts's
          //   `mapKeys` passes an unrecognised key through undecoded, both directions) — this
          //   cast only tells TypeScript what runtime already knows.
          attributesOf(live as unknown as Record<string, unknown>, props),
    ),
  );

/** No purge, no skiplock, no destroy-unreferenced-disks. A missing config is already gone. */
export const deleteQemu = (props: VmProps) =>
  qemuTask(
    props,
    nodes.deleteNodeQemu({ node: props.node, vmid: String(props.vmid) }),
    `destroy VM ${String(props.vmid)}`,
    DELETE_POLLS,
  ).pipe(Effect.catchTag('QemuConfigNotFound', () => Effect.void));

/**
 * ★ ONE PLACE, RUN BEFORE EVERY DIFF AND EVERY RECONCILE. A key smuggled past `VmProps`'s types
 *   (a cast, a JS caller: `cipassword`, `machine`, `hookscript`) is refused here rather than
 *   silently dropped from the form or silently sent — the same rule `lxc-create-form.ts` enforces
 *   for `Proxmox.Lxc`, and the check `qemu-props.ts`'s `cipassword?: never`/`machine?: never`
 *   cannot make by itself once a caller casts around the type.
 */
const refuseUnmanaged = (props: VmProps) => {
  const refused = formRefusals(props);
  return refused.length === 0 ? Effect.void : Effect.fail(new QemuRefusedError(refused.join('\n')));
};

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
    yield* refuseUnmanaged(news);
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
    yield* refuseUnmanaged(news);
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
