/**
 * The calls a `Proxmox.Lxc` makes: read one config, create, update in place, grow, delete.
 *
 * ⛔ A READ FAILURE IS A FAILURE HERE, NOT "ABSENT" — THE ONE PLACE THIS PACKAGE DEPARTS FROM
 *   resource.ts. `pveOperations.read` folds every error into `undefined`, which for a guest means a
 *   403 or a node that did not answer plans a CREATE over a running container. PVE answers a
 *   missing guest with HTTP 500, `Configuration file 'nodes/<node>/lxc/<vmid>.conf' does not
 *   exist` (pve-guest-common `AbstractConfig::load_config`), so only a 500 may mean absent — and
 *   even then only after the cluster says so, below. Anything else fails the plan.
 *
 * ⛔ "ABSENT" IS DECIDED BY THE WHOLE CLUSTER, NOT BY THE ERROR TEXT. A config lives under its
 *   node, so a guest migrated to another node — or a QEMU VM holding the same cluster-wide vmid —
 *   also reads as missing at the declared path. `GET /cluster/resources?type=vm` settles it: the
 *   vmid nowhere is absent; the vmid anywhere else FAILS the read with where it is; the vmid on
 *   the declared node fails with PVE's own error. ★ Keyed on the cluster rather than on matching
 *   the message, so a PVE that words it differently still cannot turn into a create.
 *
 * ⚠️ CREATE, RESIZE AND DELETE ARE ASYNCHRONOUS; A CONFIG PUT IS NOT. The first three answer a
 *   UPID the moment PVE forks the worker (`NodesNodeLxcPostReturn`, `…ResizePutReturn`,
 *   `…VmidDeleteReturn` are all `string`), so each waits for its task's exitstatus. `PUT …/config`
 *   answers `null` after writing (`…ConfigPutReturn`), so it needs no wait.
 * ⛔ EACH TASK IS POLLED WITH THE CREDENTIAL THAT STARTED IT — see `awaitTask`: only the owner
 *   skips `Sys.Audit`. A fresh `provision` mint per write gives the full 300s lease a create needs;
 *   a cached lease can be handed out with 60s left (lease-cache.ts).
 */
import * as Effect from 'effect/Effect';
import { PveError, pve, pveWith } from './client.ts';
import { type PveTarget, mint } from './credentials.ts';
import { createForm } from './lxc-create-form.ts';
import { type LxcChange, judge } from './lxc-judge.ts';
import type { LxcAttributes, LxcProps } from './lxc-props.ts';
import { rawKeysOf, storedConfig } from './lxc-props.ts';
import { awaitTask } from './network-apply-read.ts';
import { text, withClears } from './values.ts';

/** A plan-time or apply-time refusal. Nothing was written when one of these is raised. */
export class LxcRefusedError extends Error {
  override readonly name = 'LxcRefusedError';
}

/** Where one guest lives. Its identity, and nothing else. */
export type LxcWhere = { readonly target: PveTarget; readonly node: string; readonly vmid: number };

export const guestPath = (where: LxcWhere) => `nodes/${where.node}/lxc/${String(where.vmid)}`;

/** How long each task may run, in one-second polls. ⚠️ A cap, not an estimate. */
const CREATE_POLLS = 180;
const TASK_POLLS = 60;

const isServerError = (error: unknown): error is PveError =>
  error instanceof PveError && error.status === 500;

/** One `GET /cluster/resources?type=vm` row. */
type GuestRow = { readonly vmid?: unknown; readonly node?: unknown; readonly type?: unknown };

/** The live config, or undefined when no guest holds this vmid anywhere in the cluster. */
export const readLive = (where: LxcWhere) =>
  Effect.gen(function* () {
    const answer = yield* pve<Record<string, unknown> | null>(
      where.target,
      'read',
      'GET',
      `${guestPath(where)}/config`,
    ).pipe(
      Effect.map((data) => ({ data, error: undefined })),
      Effect.catchIf(isServerError, (error) => Effect.succeed({ data: undefined, error })),
    );
    if (answer.data !== undefined && answer.data !== null) return answer.data;
    const rows = yield* pve<readonly GuestRow[]>(
      where.target,
      'read',
      'GET',
      'cluster/resources?type=vm',
    );
    // ⚠️ `Number()`, NOT `===` ON THE RAW VALUE: a vmid that came back as `"900"` would otherwise
    //   match nothing, and "listed nowhere" is the one answer that turns into a create.
    const found = (rows ?? []).find((row) => Number(row.vmid) === where.vmid);
    if (found !== undefined && found.node === where.node && found.type === 'lxc') {
      return yield* Effect.fail(
        answer.error ??
          new LxcRefusedError(`CT ${String(where.vmid)} is listed but its config read empty.`),
      );
    }
    if (found !== undefined) {
      return yield* Effect.fail(
        new LxcRefusedError(
          `vmid ${String(where.vmid)} is a ${text(found.type, 'guest')} on ` +
            `${text(found.node, '?')}, not a container on ${where.node}. A migration is not an ` +
            'update and vmids are cluster-wide: declare the node it is on, or pick a free vmid.',
        ),
      );
    }
    return undefined;
  });

export const attributesOf = (where: LxcWhere, live: Record<string, unknown>): LxcAttributes => ({
  config: storedConfig(live),
  node: where.node,
  rawKeys: rawKeysOf(live),
  vmid: where.vmid,
});

/** Run one task-starting call and wait for it on the same credential. Fails unless `OK`. */
const task = (
  where: LxcWhere,
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  what: string,
  polls: number,
  form?: Record<string, string>,
) =>
  Effect.gen(function* () {
    const credential = yield* mint(where.target, 'provision');
    const upid = text(yield* pveWith<string>(where.target, credential, method, path, form));
    if (upid === '') {
      return yield* Effect.fail(
        new LxcRefusedError(
          `${what}: PVE returned no task id, so the write cannot be confirmed and is not claimed.`,
        ),
      );
    }
    const exit = yield* awaitTask(where.target, credential, where.node, upid, polls);
    if (exit !== 'OK') {
      return yield* Effect.fail(
        new LxcRefusedError(
          `${what}: task ${upid} ended "${exit}". Read \`pvesh get /nodes/${where.node}/tasks/` +
            `${upid}/log\` before running the deploy again.`,
        ),
      );
    }
  });

/** POST the create and wait for the template to unpack. ⛔ Refusals are the caller's to check. */
export const createGuest = (props: LxcProps) =>
  task(
    props,
    'POST',
    `nodes/${props.node}/lxc`,
    `create CT ${String(props.vmid)}`,
    CREATE_POLLS,
    createForm(props),
  );

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
      yield* pve(props.target, 'provision', 'PUT', `${guestPath(props)}/config`, form);
    }
    for (const grow of change.resize) {
      yield* task(
        props,
        'PUT',
        `${guestPath(props)}/resize`,
        `grow ${grow.disk} of CT ${String(props.vmid)} to ${grow.size}`,
        TASK_POLLS,
        { disk: grow.disk, size: grow.size },
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
    yield* task(where, 'DELETE', guestPath(where), `destroy CT ${String(where.vmid)}`, TASK_POLLS);
  });
