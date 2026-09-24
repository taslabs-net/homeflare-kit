/**
 * The create lane for `Proxmox.ZfsPool`: the form PVE wants, and the wait for the worker it forks.
 * Split out of zfs-pool.ts (2026-09-24, the distilled migration) — same seam as before, now naming
 * the write side the way storage.ts/storage-form.ts does.
 *
 * ⚠️ `createPool` TAKES THE READ AS A PARAMETER, GENERIC IN ITS ERROR AND REQUIREMENT CHANNELS,
 *   rather than importing the read module and coupling to its exact effect shape here. This file
 *   answers "how does a declaration become a pool on disks"; zfs-pool-wire.ts answers "what is a
 *   zpool, and when has it changed" — the caller (zfs-pool.ts) is what ties the two together, so
 *   this file cannot accidentally read the cluster differently from `diff`.
 */
import * as Effect from 'effect/Effect';
import * as nodes from '@distilled.cloud/proxmox/nodes';
import { asForm } from './distilled-guard.ts';
import { guardForm } from './constraint-guard.ts';
import { runPve } from './distilled-pve.ts';
import { text } from './values.ts';
import type { ZfsPoolAttributes, ZfsPoolProps } from './zfs-pool.ts';
import type { NodesNodeDisksZfsPostParams } from './generated/pve.ts';

export const ZFS_POOL_CREATE = 'pve:POST /nodes/{node}/disks/zfs';

/**
 * PVE's layouts, generated (2026-09-23) from `NodesNodeDisksZfsPostParams['raidlevel']`
 * (`generated/pve.ts`, manifest `pve-apidoc` pve-manager 9.2.11 sha256 9def8f13…) rather than
 * hand-typed, per decision 9. ⚠️ Each has a minimum disk count PVE enforces, and `raid10` needs an
 * even one. ⛔ THERE IS NO `stripe` IN THIS ENUM. n1's `speed` pool is one (decision 14 accepts it
 * as-is): `ZfsPoolProps` (zfs-pool.ts) is why a stripe pool is declarable at all — as an
 * ADOPT-ONLY declaration with no `raidlevel`, never as a full one.
 */
export type ZfsRaidLevel = NonNullable<NodesNodeDisksZfsPostParams['raidlevel']>;

/** Generated the same way, from `NodesNodeDisksZfsPostParams['compression']`. */
export type ZfsCompression = NonNullable<NodesNodeDisksZfsPostParams['compression']>;

/**
 * ★ CHECKED AGAINST THE VENDOR TABLE ONLY FOR A FULL DECLARATION — decision 9's adopt-only mode.
 *   `guardCreate` (distilled-guard.ts's `guardWrite`) runs on the FIRST plan of ANY declaration and
 *   checks the create form's REQUIRED fields whenever this resolves to the real endpoint key — and
 *   PVE marks both `devices` and `raidlevel` required (codegen/constraints's `pve-nodes-disks`
 *   row). An adopt-only declaration deliberately omits both, so checking it would refuse a MATCHING
 *   adoption at plan time, before `read` ever ran. Returning `undefined` (no key) makes the guard a
 *   no-op for an adopt-only declaration, while a FULL one (`devices` and `raidlevel` both present)
 *   is checked exactly as before — zfs-pool.ts's `diff` passes this as the `guardWrite` endpoint.
 * ⚠️ THE RUNTIME BACKSTOP IS `createPool` BELOW, NOT THIS FUNCTION. Skipping the plan-time guard
 *   for an adopt-only declaration does not skip the check that the pool is actually there —
 *   `createPool` refuses before any POST when the read comes back absent and either field is
 *   undefined, which is what a genuinely absent adopt-only declaration hits at apply time.
 */
export const zfsPoolCreateEndpoint = (props: ZfsPoolProps) =>
  props.devices === undefined || props.raidlevel === undefined ? undefined : ZFS_POOL_CREATE;

/**
 * The wire form, PVE's own field names — what `guardWrite` (zfs-pool.ts) checks.
 *
 * ⚠️ `devices` IS JOINED IN DECLARED ORDER AND NOT PUT THROUGH `csv()` FROM values.ts. `csv` sorts,
 *   and PVE walks this list two at a time to pair `raid10` mirrors — MEASURED in the node's own
 *   `PVE::API2::Disks::ZFS` — so sorting it builds a different pool from the one declared. The list
 *   is never compared against anything, so it needs no normalisation, only faithful order.
 * ⚠️ AN OMITTED OPTIONAL IS NOT SENT. PVE's own defaults (ashift 12, compression on) are then
 *   applied by the node. Sending a guessed default would be indistinguishable here — the values
 *   are unreadable afterwards either way — but it would put a number in the request that no
 *   declaration asked for, and this is the one call that writes to physical disks.
 * ⚠️ `node` IS NOT IN THE FORM: it is the `nodes/{node}` path label, and a second copy could only
 *   disagree with it.
 * ⚠️ EVERY KEY IS OMITTED WHEN ABSENT, `devices` AND `raidlevel` INCLUDED — not just the optional
 *   ones. An adopt-only declaration (both undefined, decision 9) must produce a form `createPool`'s
 *   own guard can inspect for their absence, and one this function itself does not throw building.
 */
export const createForm = (props: ZfsPoolProps): Record<string, string> => ({
  ...(props.devices === undefined ? {} : { devices: props.devices.join(',') }),
  name: props.name,
  ...(props.raidlevel === undefined ? {} : { raidlevel: props.raidlevel }),
  ...(props.ashift === undefined ? {} : { ashift: String(props.ashift) }),
  ...(props.compression === undefined ? {} : { compression: props.compression }),
  ...(props['draid-config'] === undefined ? {} : { 'draid-config': props['draid-config'] }),
});

/**
 * The actual `createNodeDiskZfs` call body — `createForm` plus the `node` label, `draid-config`
 * renamed to distilled's `draid_config` (`T.Body("draid-config")` on the generated schema; the
 * ONE hyphenated field this family's create form carries — storage-form.ts's `underscored` has
 * the fuller measurement, not repeated here for one field).
 *
 * ⚠️ `as unknown as` — `devices`/`raidlevel` are REQUIRED in distilled's generated
 *   `CreateNodeDiskZfsRequest`, so an adopt-only form (both omitted) cannot satisfy it structurally
 *   even though it is a valid PVE request for `guardWrite`'s purposes. `createPool` below refuses
 *   before ever reaching this cast when either is genuinely missing, so the cast never carries a
 *   request distilled's OWN required fields would reject in practice.
 */
const toDistilledCreate = (props: ZfsPoolProps): nodes.CreateNodeDiskZfsRequest => {
  const form = createForm(props);
  return {
    ...form,
    draid_config: form['draid-config'],
    node: props.node,
  } as unknown as nodes.CreateNodeDiskZfsRequest;
};

/** 30 reads, 2s apart. A create that has not landed in a minute has gone wrong, not gone slow. */
const SETTLE_ATTEMPTS = 30;

/**
 * Create the pool if it is absent, and otherwise leave it completely alone.
 *
 * ⛔ THE POST ONLY FORKS A WORKER. MEASURED in `/usr/share/perl5/PVE/API2/Disks/ZFS.pm` on node-b:
 *   the create handler ends in `$rpcenv->fork_worker('zfscreate', ...)` and its HTTP answer is a
 *   UPID returned the instant the worker is forked — before `zpool create` has run, let alone
 *   finished. A read-back taken immediately would report a successful create as the failure "the
 *   write returned no error but the object is still absent". THAT is why this function polls.
 *
 * ⚠️ THERE IS NO UPDATE BRANCH BECAUSE PVE HAS NO PUT HERE. An existing pool is returned exactly as
 *   read, unwritten: the only write this resource ever makes is the create of a pool that is not
 *   there. Do not add a "repair" write; there is no field it could set.
 *
 * ⛔ AND IF THE READ IS WRONG, THE POST IS STILL SAFE — measured, not hoped for. `readPool` folds a
 *   403 or an unreachable node into "absent", so a too-narrow lease would send this down the create
 *   path over a live pool. PVE's handler calls `get_pool_data()` before it forks anything and dies
 *   with "pool '<name>' already exists on node '<node>'", and `assert_disk_unused` refuses every
 *   device that pool is holding. A create aimed at a pool that is really there fails loudly rather
 *   than wiping it.
 *
 * ⚠️ SHORT POLLS WITH A HARD CAP, NOT ONE LONG WAIT, NOT `@distilled.cloud/proxmox`'s `awaitTask`.
 *   `readPool` cannot tell "not yet" from "forbidden" — both fold to `undefined` — so the loop
 *   gives up with the UPID rather than retrying forever, and the UPID is the only thing that leads
 *   to the worker's real error. Distilled's own task-status poller exists (`Task.ts`) and would
 *   remove this ambiguity, but swapping to it changes this resource's OBSERVABLE behaviour (what a
 *   caller sees on a slow create) beyond a transport swap — left as a follow-up, not folded into a
 *   migration PR silently.
 *
 * ⛔ THE SAME AMBIGUITY MAKES A RE-RUN AFTER THE GIVE-UP DIE GENUINELY UNSAFE, NOT MERELY SLOW TO
 *   CONFIRM — FOUND BY ADVERSARIAL REVIEW, 2026-09-24, of THIS migration, though the shape is
 *   unchanged from before it (`git blame` shows the same settle-poll pre-dates this PR). "If the
 *   read is wrong, the POST is still safe" above is true for the FIRST call into this function —
 *   PVE's own `get_pool_data()` refuses a create over a pool it can already see. It is NOT true
 *   for a SECOND deploy attempt started while the FIRST worker is still mid-`zpool create`: that
 *   worker has not yet made the pool visible to a read, so `existing = yield* read(props)` at the
 *   top of THIS call can also fold to `undefined` — not because the pool is gone, but because the
 *   first attempt has not finished — and this function would POST a SECOND `zpool create` at the
 *   SAME devices while the first is still writing them. There is no lock or marker anywhere in
 *   this package that would stop it. The give-up message below says so explicitly and names the
 *   task log to check FIRST; that message, and an operator reading it, are the only safeguard.
 *
 * ⛔ THE ADOPT-ONLY GUARD, RIGHT AFTER THE READ AND BEFORE ANYTHING ELSE. Decision 9 (2026-09-23):
 *   omitting `devices` and `raidlevel` declares a pool this resource may only ADOPT, for a pool
 *   PVE's own schema cannot fully describe — n1's `speed` is a stripe, and `raidlevel`'s enum has
 *   no stripe (zfs-pool.ts). `zfsPoolCreateEndpoint` above already keeps the vendor constraint
 *   guard from refusing such a declaration at PLAN time; this is the matching refusal at APPLY
 *   time, for the one case that guard cannot see — the pool genuinely is not there.
 */
export const createPool = <E, R>(
  props: ZfsPoolProps,
  read: (props: ZfsPoolProps) => Effect.Effect<ZfsPoolAttributes | undefined, E, R>,
) =>
  Effect.gen(function* () {
    const existing = yield* read(props);
    if (existing !== undefined) return existing;

    if (props.devices === undefined || props.raidlevel === undefined) {
      return yield* Effect.die(
        new Error(
          `${props.node}/${props.name}: this is an adopt-only declaration (no \`devices\` or ` +
            '`raidlevel`) and the pool is not there to adopt. An adopt-only Proxmox.ZfsPool never ' +
            'creates -- declare both fields for a pool this resource should build, or point this ' +
            'declaration at a pool that already exists on this node.',
        ),
      );
    }

    /**
     * ⛔ FOUND BY ADVERSARIAL REVIEW, 2026-09-24 — `diff` NEVER RUNS FOR A GENUINELY FIRST-EVER
     *   DECLARATION. Upstream `Plan.ts` routes a brand-new resource (`oldState === undefined`)
     *   straight to `action: 'create'` without ever calling `provider.diff` — so `zfs-pool.ts`'s
     *   own `guardForm` call (which checks THIS SAME form) never runs for that plan, and this was
     *   THE ONLY WRITE PATH IN THE FAMILY WITH NO VENDOR CHECK AT ALL, before or after this
     *   migration. `ceph-pool.ts`'s own hand-written `reconcile` already re-runs its create guard
     *   for exactly this reason (an ADOPTED row's `diff` answer is discarded by Plan.ts too); this
     *   is the same fix for this family. A malformed `ashift` or `draid-config` is now refused
     *   here, before the POST, rather than reaching the wire and refused only by PVE itself.
     */
    yield* guardForm(zfsPoolCreateEndpoint(props), asForm(createForm(props)), true);

    const upid = yield* runPve(
      props.target,
      'provision',
      true,
      nodes.createNodeDiskZfs(toDistilledCreate(props)),
    );

    const settle = (attempts: number): Effect.Effect<ZfsPoolAttributes | undefined, E, R> =>
      Effect.gen(function* () {
        const live = yield* read(props);
        if (live !== undefined || attempts <= 0) return live;
        yield* Effect.sleep('2 seconds');
        return yield* settle(attempts - 1);
      });

    const after = yield* settle(SETTLE_ATTEMPTS);
    if (after === undefined) {
      return yield* Effect.die(
        new Error(
          `nodes/${props.node}/disks/zfs/${props.name}: POST returned ${text(upid, '(no UPID)')} ` +
            'but the pool has not appeared. That POST only forks a `zfscreate` worker, so the task ' +
            `holds the real error -- read it with \`pvesh get /nodes/${props.node}/tasks/<upid>/log\`. ` +
            'NOTHING WAS RETRIED AND NOTHING WAS CLEANED UP: if the worker reached `zpool create`, ' +
            'the declared devices have already been written to. DO NOT RE-RUN THIS DEPLOY BEFORE ' +
            'READING THAT LOG: `read` cannot tell "the worker is still running" from "the pool is ' +
            'genuinely gone", so a re-run this soon can POST a SECOND `zpool create` at the SAME ' +
            'devices while the first one is still mid-write -- confirm the task finished (one way ' +
            'or the other) before trying again.',
        ),
      );
    }
    return after;
  });

/**
 * ⛔ `DELETE /nodes/{node}/disks/zfs/{name}` RUNS `zpool destroy` AND THE DATASETS GO WITH IT. Per
 *   S14 (alchemy-provider-standard), it is implemented rather than stubbed — a `delete` that
 *   silently does nothing lies to whoever reads the plan — and what keeps an ordinary removed
 *   declaration from reaching it is the resource's `defaultRemovalPolicy: 'retain'` (zfs-pool.ts):
 *   an orphaned pool is forgotten, not destroyed, unless a caller opts in with
 *   `.pipe(RemovalPolicy.destroy())`. See the corrected header in zfs-pool.ts.
 *
 * ⚠️ `cleanup-config`/`cleanup-disks` ARE NOT SENT. The first would additionally remove the PVE
 *   storage entry pointing at this pool, which is a different object with its own resource
 *   (`Proxmox.Storage`); one resource reaching over to delete another's is how a stack ends up with
 *   state describing something that is gone. Neither is offered as a prop, for the same reason.
 */
export const destroyPool = (props: ZfsPoolProps) =>
  runPve(
    props.target,
    'provision',
    true,
    nodes.deleteNodeDiskZfs({ name: props.name, node: props.node }),
  );
