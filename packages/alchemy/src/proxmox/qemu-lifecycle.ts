/**
 * QEMU lifecycle on named operations.
 * ⛔ GET and PUT use `/nodes/{node}/qemu/{vmid}/config`. DELETE uses `/nodes/{node}/qemu/{vmid}`.
 *   qemu-server Qemu.pm names that second route `destroy_vm`. Sending DELETE to the config
 *   route does not destroy the guest.
 *
 * ⛔ WRITES GO THROUGH `qemu-judge.ts`, NOT A WHOLE-FORM PUT (2026-09-26, red-team C1/C2/I1 on
 *   PR 297). `judge` decides per key, on the live volume id and live MAC (qemu-volume.ts,
 *   qemu-net.ts); only drifted keys are sent. `ownedRead`/`refuseTakeover` (C2) refuse to adopt or
 *   write a live VM this stack holds no state for, unless `--adopt` / `adopt(true)` says so —
 *   ownership.md's rule, ported here the way openbao/policy.ts already does it. `identityRefusal`
 *   (I1) refuses a changed vmid rather than building a second VM.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { refuseTakeover } from '../ownership/adopt.ts';
import { ownedRead } from '../ownership/probe.ts';
import { runPve } from './distilled-pve.ts';
import { createForm, formRefusals } from './qemu-form.ts';
import { QemuRefusedError } from './qemu-errors.ts';
import { identityRefusal, judge } from './qemu-judge.ts';
import type { VmAttributes, VmProps } from './qemu-props.ts';
import { readVm } from './qemu-read.ts';
import { qemuTask } from './qemu-task.ts';
import { attributesOf, guardCreate, guardUpdate, spec } from './qemu-spec.ts';
import { type QemuDiskResizeRefused, checkLiveDiskSizes, validateDiskSizes } from './qemu-size.ts';
import { resizeDisks } from './qemu-resize.ts';

const CREATE_POLLS = 180;
const DELETE_POLLS = 60;

// ★ mint's legacy Error must not erase these tags from the inferred union (distilled-pve.ts).
type QemuLifecycleError =
  | Effect.Error<ReturnType<typeof readQemu>>
  | nodes.PutNodeQemuResizeError
  | QemuRefusedError
  | QemuDiskResizeRefused;

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

const refuseChange = (change: { readonly refuse: readonly string[] }) =>
  change.refuse.length === 0
    ? Effect.void
    : Effect.fail(new QemuRefusedError(change.refuse.join('\n')));

export const qemuHandlers = {
  list: () => Effect.succeed([]),
  /**
   * ⛔ `Unowned` UNLESS STATE ALREADY VOUCHES FOR IT (C2). With no attributes this is Alchemy's
   *   adoption probe or the recovery read for an interrupted create (ownership/probe.ts); `settled`
   *   is the same `judge` reconcile uses, so "proven ours" and "reconcile would write nothing" are
   *   the same question asked once.
   */
  read: Effect.fn(function* ({
    fqn,
    instanceId,
    olds,
    output,
  }: {
    fqn: string;
    instanceId: string;
    olds: VmProps;
    output: VmAttributes | undefined;
  }) {
    const found = yield* readQemu(olds);
    const settled = Effect.sync(
      () => found !== undefined && judge(olds, found.config).drift.length === 0,
    );
    return yield* ownedRead({ fqn, instanceId, output }, found, settled);
  }),
  diff: Effect.fn(function* ({
    news,
    olds,
    output,
  }: {
    news: Input<VmProps>;
    olds: VmProps;
    output: VmAttributes | undefined;
  }): Effect.fn.Return<
    { readonly action: 'noop' | 'update' } | undefined,
    QemuLifecycleError,
    HttpClient.HttpClient
  > {
    if (!isResolved(news)) return undefined;
    const identity = identityRefusal(news.vmid, output?.vmid ?? olds.vmid);
    if (identity !== undefined) return yield* Effect.fail(new QemuRefusedError(identity));
    yield* refuseUnmanaged(news);
    yield* validateDiskSizes(news, olds);
    yield* guardCreate(news, output === undefined);
    yield* guardUpdate(news);
    if (output === undefined) return undefined;
    const live = yield* readQemu(news);
    if (live === undefined) {
      // ⚠️ `update`, not `create`: state exists and the VM does not. reconcile rebuilds it from the
      //   declaration -- said here too, so an operator reading the plan sees it before the deploy.
      yield* Effect.logWarning(
        `Proxmox.Vm ${news.node}/${String(news.vmid)}: the cluster lists no VM with this vmid -- ` +
          'a deploy CREATES it again, with new, empty volumes.',
      );
      yield* guardCreate(news, true);
      return { action: 'update' } as const;
    }
    yield* checkLiveDiskSizes(news, live.config, true);
    const change = judge(news, live.config);
    yield* refuseChange(change);
    return { action: change.drift.length === 0 ? 'noop' : 'update' } as const;
  }),
  reconcile: Effect.fn(function* ({
    fqn,
    instanceId,
    news,
    olds,
    output,
  }: {
    fqn: string;
    instanceId: string;
    news: VmProps;
    olds: VmProps | undefined;
    output: VmAttributes | undefined;
  }): Effect.fn.Return<VmAttributes, QemuLifecycleError, HttpClient.HttpClient> {
    const identity = identityRefusal(news.vmid, output?.vmid ?? olds?.vmid);
    if (identity !== undefined) return yield* Effect.fail(new QemuRefusedError(identity));
    yield* refuseUnmanaged(news);
    yield* validateDiskSizes(news, olds);
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
      // ⛔ C2: a live VM this stack holds no state for is refused unless adoption is on — dies
      //   (never returns) for a fresh create/replace generation; a no-op otherwise (adopt.ts).
      yield* refuseTakeover(
        { fqn, instanceId, output },
        `Proxmox.Vm VM ${String(news.vmid)} on ${news.node}`,
      );
      yield* checkLiveDiskSizes(news, live.config, true);
      const change = judge(news, live.config);
      yield* refuseChange(change);
      if (Object.keys(change.put).length > 0) {
        yield* runPve(
          news.target,
          'provision',
          true,
          nodes.putNodeQemuConfig({ ...change.put, node: news.node, vmid: String(news.vmid) }),
        );
      }
    }
    let after = yield* readQemu(news);
    if (after === undefined) {
      return yield* Effect.fail(
        new QemuRefusedError(
          `${spec.path(news)}: write returned success but the VM is still absent`,
        ),
      );
    }
    if (yield* resizeDisks(news, after.config)) {
      after = yield* readQemu(news);
      if (after === undefined)
        return yield* Effect.fail(new QemuRefusedError('VM disappeared after resize'));
    }
    const left = judge(news, after.config);
    if (left.drift.length > 0) {
      return yield* Effect.fail(
        new QemuRefusedError(
          `${spec.path(news)}: after the write, ${left.drift.join(', ')} still differ from the ` +
            'declaration. PVE may have normalised the value -- declare what it stores.',
        ),
      );
    }
    return after;
  }),
  delete: ({ olds }: { olds: VmProps }) => deleteQemu(olds),
};
