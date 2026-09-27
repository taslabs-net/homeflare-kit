/**
 * The calls a `Proxmox.Lxc` makes: read one config, create, update in place, grow, delete.
 *
 * ★ Discovery lives in lxc-read.ts; it proves precise absence with one read credential.
 *   Writes use named distilled operations, and lxc-task.ts preserves task ownership and bounds.
 *
 * ⚠️ CREATE, RESIZE AND DELETE ARE ASYNCHRONOUS; A CONFIG PUT IS NOT. The first three answer a
 *   UPID the moment PVE forks the worker (`NodesNodeLxcPostReturn`, `…ResizePutReturn`,
 *   `…VmidDeleteReturn` are all `string`), so each waits for its task's exitstatus. `PUT …/config`
 *   answers `null` after writing (`…ConfigPutReturn`), so it needs no wait.
 * ⛔ EACH TASK IS POLLED WITH THE CREDENTIAL THAT STARTED IT — see `lxcTask`: only the owner
 *   skips `Sys.Audit`. A fresh `provision` mint per write gives the full 300s lease a create needs;
 *   a cached lease can be handed out with 60s left (lease-cache.ts).
 */
import * as Effect from 'effect/Effect';
import * as nodes from '@distilled.cloud/proxmox/nodes';
import { runPve } from './distilled-pve.ts';
import { LxcRefusedError, type LxcWhere } from './lxc-errors.ts';
import { readLive } from './lxc-read.ts';
import { lxcTask } from './lxc-task.ts';
import { guardForm } from './constraint-guard.ts';
import type { EndpointKey } from './constraints.ts';
import { createForm } from './lxc-create-form.ts';
import { type LxcChange, judge } from './lxc-judge.ts';
import type { LxcAttributes, LxcProps } from './lxc-props.ts';
import { rawKeysOf, storedConfig } from './lxc-props.ts';
import { text, withClears } from './values.ts';

export { LxcRefusedError, type LxcWhere } from './lxc-errors.ts';
export { readLive } from './lxc-read.ts';

/**
 * The three vendor endpoints a guest is written through, as the generated tables key them.
 *
 * ⛔ DECLARED HERE RATHER THAN ON A SPEC BECAUSE `Proxmox.Lxc` HAS NO SPEC — lxc.ts writes all
 *   five handlers by hand (a guest reads failures as failures, waits on tasks and grows disks
 *   through a second endpoint), so it cannot inherit the shared guard from resource.ts. Without
 *   these three it would be the largest write surface in the package with nothing checking the
 *   body: `POST /nodes/{node}/lxc` alone carries 26 constrained parameters.
 * ⚠️ THREE, NOT TWO. `resize` is a separate PVE endpoint with its own schema — `disk` against an
 *   enum of `rootfs` and `mp0..mp255`, `size` against PVE's `+<n>` / `<n>` pattern — and it is
 *   the one lxc-volume.ts drives.
 * ⛔ `{vmid}` AND `{node}` ARE PATH SEGMENTS, NOT FORM KEYS, on the two PUTs. On the POST `vmid`
 *   IS a form key and is required, which is why `createForm` sends it.
 */
const LXC_ENDPOINTS = {
  create: 'pve:POST /nodes/{node}/lxc' as EndpointKey,
  resize: 'pve:PUT /nodes/{node}/lxc/{vmid}/resize' as EndpointKey,
  update: 'pve:PUT /nodes/{node}/lxc/{vmid}/config' as EndpointKey,
};

/** How long each task may run, in one-second polls. ⚠️ A cap, not an estimate. */
const CREATE_POLLS = 180;
const TASK_POLLS = 60;

export const attributesOf = (where: LxcWhere, live: Record<string, unknown>): LxcAttributes => ({
  config: storedConfig(live),
  node: where.node,
  rawKeys: rawKeysOf(live),
  vmid: where.vmid,
});

/** POST the create and wait for the template to unpack. ⛔ Refusals are the caller's to check. */
export const createGuest = (props: LxcProps) =>
  Effect.gen(function* () {
    const form = createForm(props);
    /**
     * ⛔ BEFORE THE POST, AND WITH PRESENCE, BECAUSE THIS IS UNCONDITIONALLY A CREATE. Reached
     *   only when the guest is absent (lxc.ts's reconcile), so the vendor's required parameters
     *   really are about to go on the wire — `ostemplate` and `vmid`, both of which
     *   `createRefusals` already insists on, plus every bound the schema carries and nothing here
     *   knew: `cores` 1..8192, `memory` ≥ 16, `hostname` as a dns-name, `tags`, `startup`.
     */
    yield* guardForm(LXC_ENDPOINTS.create, form, true);
    return yield* lxcTask(
      props,
      nodes.createNodeLxc({
        ...form,
        node: props.node,
        vmid: String(props.vmid),
        ostemplate: text(form['ostemplate']),
      }),
      `create CT ${String(props.vmid)}`,
      CREATE_POLLS,
    );
  });

/**
 * Apply a judged change: the config PUT first, then each resize.
 * ⚠️ IN THAT ORDER BECAUSE A MOUNT POINT'S PUT CARRIES ITS LIVE `size=`, and the resize rewrites it.
 * ⛔ THE PUT CARRIES THE `digest` OF THE CONFIG IT WAS JUDGED AGAINST. PVE refuses the write if the
 *   file changed since (`assert_if_modified`), so an edit landing between reconcile's own read and
 *   its PUT fails the deploy instead of being overwritten by a change computed from the older file.
 * ⚠️ THE DIGEST IS THE DEPLOY'S READ, NOT THE PLAN'S. A hand edit between `plan` and `deploy` is
 *   seen by reconcile's fresh judge instead: a declared key edited meanwhile is written back to the
 *   declaration (even after a plan that warned of nothing), an undeclared one is left alone.
 */
export const updateGuest = (props: LxcProps, change: LxcChange, digest: string) =>
  Effect.gen(function* () {
    if (Object.keys(change.put).length > 0 || change.clear.length > 0) {
      const form = withClears(
        { ...change.put, ...(digest === '' ? {} : { digest }) },
        change.clear,
      );
      /** ⚠️ NO PRESENCE: this form is partial by construction — it is `judge`'s answer. */
      yield* guardForm(LXC_ENDPOINTS.update, form, false);
      yield* runPve(
        props.target,
        'provision',
        true,
        nodes.putNodeLxcConfig({ ...form, node: props.node, vmid: String(props.vmid) }),
      );
    }
    for (const grow of change.resize) {
      const grown = { disk: grow.disk, size: grow.size };
      // ⛔ WITH PRESENCE: `disk` and `size` are both required and both always sent, so this is a
      //   value check over PVE's own `+<n>` size pattern and its `rootfs|mp0..mp255` enum.
      yield* guardForm(LXC_ENDPOINTS.resize, grown, true);
      yield* lxcTask(
        props,
        nodes.putNodeLxcResize({ ...grown, node: props.node, vmid: String(props.vmid) }),
        `grow ${grow.disk} of CT ${String(props.vmid)} to ${grow.size}`,
        TASK_POLLS,
      );
    }
  });

/**
 * ⛔ NO `force`, NO `purge`, NO STOP FIRST. PVE refuses to destroy a running or protected guest,
 *   and that refusal is kept: stopping a guest so a delete can proceed is an operator's decision.
 *   Reached only under `RemovalPolicy.destroy()` — this resource retains by default.
 * ⛔ AND ONLY THE GUEST THIS STACK DECLARED. State holds a vmid, and a vmid is reusable: after a
 *   hand `pct destroy` and a new `pct create` at the same id, "delete CT 150" is somebody else's
 *   container and all its volumes. So the live guest is judged against the last declaration
 *   first; one that no longer matches is refused with the keys that differ, and deleting it (or
 *   declaring it again) is the operator's call.
 */
export const destroyGuest = (where: LxcWhere, declared: LxcProps) =>
  Effect.gen(function* () {
    const live = yield* readLive(where);
    if (live === undefined) return;
    const drift = judge(declared, live).drift;
    if (drift.length > 0) {
      return yield* Effect.fail(
        new LxcRefusedError(
          `destroy CT ${String(where.vmid)}: the guest on ${where.node} no longer matches its last ` +
            `declaration (${drift.join(', ')}), so it may not be the guest this stack made. ` +
            'Nothing was deleted. Delete it by hand if it should go, or declare it again.',
        ),
      );
    }
    yield* lxcTask(
      where,
      nodes.deleteNodeLxc({ node: where.node, vmid: String(where.vmid) }),
      `destroy CT ${String(where.vmid)}`,
      TASK_POLLS,
    );
  });
