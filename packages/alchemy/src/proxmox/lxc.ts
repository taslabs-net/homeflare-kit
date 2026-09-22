/**
 * `Proxmox.Lxc` — a container, declared: adopted as it runs, or created from a template.
 *
 * ★ THE PROVISIONING BASELINE HOLDS WHAT THIS NEEDS (provision-baseline.ts): on `/`, VM.Allocate,
 *   VM.Audit, VM.Config.{CPU,Disk,HWType,Memory,Network,Options}, VM.PowerMgmt,
 *   Datastore.AllocateSpace, Datastore.Audit, SDN.Use, Sys.Audit. What no token can do — device
 *   passthrough, bind mounts, features beyond nesting — PVE keeps for root@pam, and lxc-judge.ts
 *   refuses at plan with the `pct set` to run instead.
 *
 * ⛔ NOTHING HERE PLANS A REPLACE, AND NOTHING DESTROYS A GUEST BY DEFAULT. A replace of a guest is
 *   a delete of a running machine and its disks, so every change PVE cannot make in place — a new
 *   vmid, another template, an unprivileged flip, a storage move, a smaller disk, a move to
 *   another node — FAILS the plan with a sentence instead. `defaultRemovalPolicy: 'retain'`:
 *   dropping the declaration drops the state row and leaves the guest running; only
 *   `RemovalPolicy.destroy()` reaches `destroyGuest`, which deletes only a guest that still
 *   matches its last declaration, and PVE still refuses a running or protected one.
 * ⛔ AND NOTHING HERE WRITES A VOLUME IT DID NOT ALLOCATE. A create takes `storage:GiB` only
 *   (lxc-create-form.ts), and a deploy that planned a create never writes onto a guest it finds.
 *
 * ⛔ AND AN ADOPTION NEVER CHANGES A GUEST (lxc-adoption.ts). A guest this stack adopts is taken
 *   over exactly as it runs: any key the declaration says otherwise FAILS the plan, by name (never
 *   by value), and reconcile asks again before it would write. Only an exact match adopts.
 * ⚠️ AN UPDATE STILL PLANS `update` WITHOUT A PROPERTY DIFF, so `diff` LOGS the keys a deploy would
 *   write, by name, as a warning — the only place a plan says what the deploy will change.
 *
 * ⚠️ POWER STATE IS NOT DECLARED. `onboot` is config; start and stop are an operator's act, as for
 *   `Proxmox.Vm`. `start: 1` starts a guest once, after the create that built it, and never again.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type Owner, refuseTakeover } from '../ownership/adopt.ts';
import { ownedRead } from '../ownership/probe.ts';
import { provingResumes } from '../ownership/resume.ts';
import { createRefusals } from './lxc-create-form.ts';
import { identityRefusals } from './lxc-identity.ts';
import { refuseAdoptedDrift } from './lxc-adoption.ts';
import { judge } from './lxc-judge.ts';
import {
  LxcRefusedError,
  type LxcWhere,
  attributesOf,
  createGuest,
  destroyGuest,
  readLive,
  updateGuest,
} from './lxc-lifecycle.ts';
import type { LxcAttributes, LxcProps } from './lxc-props.ts';
import type { PveRequirements } from './resource.ts';
import { text } from './values.ts';

export type { LxcAttributes, LxcProps } from './lxc-props.ts';

export interface ProxmoxLxc extends Resource<
  'Proxmox.Lxc',
  LxcProps,
  LxcAttributes,
  never,
  PveRequirements
> {}

/** ★ `retain` by default — a guest's disks cannot be rebuilt from a line. See resource.ts. */
export const ProxmoxLxc = Resource<ProxmoxLxc>('Proxmox.Lxc', { defaultRemovalPolicy: 'retain' });

/** The ownership fields of one call (ownership/adopt.ts), with this resource's attributes. */
type LxcOwner = Owner & { readonly output: LxcAttributes | undefined };

const refused = (reasons: readonly string[]) =>
  Effect.fail(new LxcRefusedError(reasons.join('\n')));

/**
 * ★ A ROW WITH NO ATTRIBUTES IS AN UNFINISHED CREATE. provingResumes (ownership/resume.ts) asks
 *   `read` whether the guest there is that create's before this runs, and notes it for the apply
 *   that follows, so reconcile can tell our own interrupted create from a guest somebody else put
 *   at this vmid.
 */
const diff = (owner: LxcOwner, news: Input<LxcProps>, olds: LxcProps) =>
  Effect.gen(function* () {
    const { output } = owner;
    const identity = identityRefusals(news, olds, output);
    if (identity.length > 0) return yield* refused(identity);
    if (output === undefined) return undefined;
    if (!isResolved(news)) return undefined;
    const live = yield* readLive(news);
    // ⚠️ `update`, not `create`: state exists and the guest does not. reconcile rebuilds it from
    //   `ostemplate`, or refuses when there is none — an adopted guest has no recipe.
    // ⛔ AND THE PLAN SAYS SO. A bare `update` here read as an edit while the deploy would build a
    //   NEW guest with empty volumes; an uncreatable one now fails at plan rather than at deploy.
    if (live === undefined) {
      const refusals = createRefusals(news);
      if (refusals.length > 0) return yield* refused(refusals);
      yield* Effect.logWarning(
        `Proxmox.Lxc ${news.node}/${String(news.vmid)}: the cluster lists no guest with this ` +
          'vmid -- a deploy CREATES it again from ostemplate, with new, empty volumes.',
      );
      return { action: 'update' } as const;
    }
    const change = judge(news, live);
    yield* refuseAdoptedDrift(owner, news, live, change);
    if (change.refuse.length > 0) return yield* refused(change.refuse);
    const moved = news.node !== output.node;
    if (change.drift.length === 0 && !moved) return { action: 'noop' } as const;
    const what =
      change.drift.length === 0
        ? `the guest is on ${news.node} now, not ${output.node} -- a deploy re-records it, ` +
          'writing nothing.'
        : `live config differs from the declaration in ${change.drift.join(', ')} -- a ` +
          'deploy writes these.';
    yield* Effect.logWarning(`Proxmox.Lxc ${news.node}/${String(news.vmid)}: ${what}`);
    return { action: 'update' } as const;
  });

/**
 * ⛔ THE SAME JUDGE AS `diff`, RE-RUN AGAINST A FRESH READ, AND AN EMPTY CHANGE WRITES NOTHING.
 *   Apply routes `adopted` through reconcile (resource.ts has the Apply.ts lines), so this is what
 *   runs on the first deploy after an adoption; for a guest that already matches it is two GETs,
 *   and for one edited since the plan it is a refusal, never a write (lxc-adoption.ts).
 * ⛔ AND IT READS BACK AND JUDGES AGAIN. PVE answers 200 on writes that did nothing, so a change
 *   that did not land is a failure here, not a state row claiming it did. ⚠️ A change PVE parked
 *   as pending on a running guest DOES read back (GET config merges `[pending]` unless asked for
 *   `current`), so it passes here and takes effect at the guest's next restart.
 * ⛔ A CREATE NEVER WRITES ONTO A GUEST THAT IS ALREADY THERE. `output` undefined means the plan
 *   said `create`: its adoption probe saw no guest, or never ran (Plan.ts skips it while any prop
 *   is an unresolved Output — a `net0` built from a vnet created in the same deploy). Finding one
 *   now, it is first an OWNERSHIP question (docs/ownership.md): `refuseTakeover` lets it through
 *   only for this resource's own interrupted create or under `--adopt` / `adopt(true)`, and
 *   otherwise refuses and forgets the `creating` row, a matching guest included. Then a CONTENT
 *   one: a guest that already matches is recorded with no write; any other refuses even under
 *   `--adopt`, until a plan can show the keys a deploy would write onto it.
 */
const reconcile = (owner: LxcOwner, news: LxcProps) =>
  Effect.gen(function* () {
    const { output } = owner;
    const identity = identityRefusals(news, news, output);
    if (identity.length > 0) return yield* refused(identity);
    const live = yield* readLive(news);
    if (live === undefined) {
      const refusals = createRefusals(news);
      if (refusals.length > 0) return yield* refused(refusals);
      yield* createGuest(news);
    } else {
      if (output === undefined) {
        yield* refuseTakeover(owner, `Proxmox.Lxc CT ${String(news.vmid)} on ${news.node}`);
      }
      const change = judge(news, live);
      if (output === undefined && change.drift.length > 0) {
        return yield* refused([
          `CT ${String(news.vmid)} already exists on ${news.node} and differs in ` +
            `${change.drift.join(', ')}, but this deploy planned a create. A create never writes ` +
            'onto an existing guest: plan again, so the plan can show it and adopt it.',
        ]);
      }
      yield* refuseAdoptedDrift(owner, news, live, change);
      if (change.refuse.length > 0) return yield* refused(change.refuse);
      if (change.drift.length > 0) yield* updateGuest(news, change, text(live['digest']));
    }
    const after = yield* readLive(news);
    if (after === undefined) {
      return yield* refused([
        `CT ${String(news.vmid)}: the write returned no error but the guest is still absent.`,
      ]);
    }
    const left = judge(news, after).drift;
    if (left.length > 0) {
      return yield* refused([
        `CT ${String(news.vmid)}: after the write, ${left.join(', ')} still differ from the ` +
          'declaration. PVE may have normalised the value (tags are lower-cased by default) -- ' +
          'declare what it stores.',
      ]);
    }
    return attributesOf(news, after);
  });

const whereOf = (olds: LxcProps, output: LxcAttributes | undefined): LxcWhere => ({
  node: output?.node ?? olds.node,
  target: olds.target,
  vmid: output?.vmid ?? olds.vmid,
});

/**
 * ⛔ NO LIVE GUEST IS ADOPTED WITHOUT `--adopt`, NOT EVEN ONE THAT MATCHES (docs/ownership.md,
 *   decided 2026-09-21). With no state this read is Alchemy's adoption probe (Plan.ts), and plain
 *   attributes would mean "ours", adopted silently. Matching is not proof: a pasted config or a
 *   mistyped vmid reads the same as our own guest, and once state claims it,
 *   `RemovalPolicy.destroy()` deletes it and its volumes from its real owner. So it reads
 *   `Unowned`, and the plan fails "Cannot adopt" until `adopt(true)` or `--adopt` says so.
 * ★ THE RECOVERY READ STILL FINISHES OUR OWN CREATE. A `creating` row whose deploy died after the
 *   POST carries its own instance id; `ownedRead` accepts the guest when the state store records
 *   that id AND the guest still matches the row's props — the same judge `diff` uses.
 * ⚠️ UNLIKE `CaddyConfig`, which keeps adopting an identical config because its delete never
 *   touches Caddy: a container's delete removes a machine and its disks.
 */
const read = (owner: LxcOwner, olds: LxcProps) =>
  Effect.gen(function* () {
    const where = whereOf(olds, owner.output);
    const live = yield* readLive(where);
    if (live === undefined) return undefined;
    const settled = Effect.sync(() => judge(olds, live).drift.length === 0);
    return yield* ownedRead(owner, attributesOf(where, live), settled);
  });

/**
 * ⛔ HAND-WRITTEN RATHER THAN `pveHandlers`: a guest reads failures as failures, grows disks
 *   through a second endpoint, waits on tasks and refuses what the factory would replace. `list`
 *   is empty for the reason it is everywhere here: `GET /nodes/{n}/lxc` lists every guest on the
 *   node, and adopting one is a declaration, never a side effect of registering the provider.
 */
type Asked = { readonly fqn: string; readonly instanceId: string };

const handlers = {
  delete: ({ olds, output }: { olds: LxcProps; output: LxcAttributes }) =>
    destroyGuest(whereOf(olds, output), olds),
  diff: ({
    fqn,
    instanceId,
    news,
    olds,
    output,
  }: Asked & { news: Input<LxcProps>; olds: LxcProps; output: LxcAttributes | undefined }) =>
    diff({ fqn, instanceId, output }, news, olds),
  list: () => Effect.succeed([]),
  read: ({
    fqn,
    instanceId,
    olds,
    output,
  }: Asked & { olds: LxcProps; output: LxcAttributes | undefined }) =>
    read({ fqn, instanceId, output }, olds),
  reconcile: ({
    fqn,
    instanceId,
    news,
    output,
  }: Asked & { news: LxcProps; output: LxcAttributes | undefined }) =>
    reconcile({ fqn, instanceId, output }, news),
};

export const ProxmoxLxcProvider = () =>
  Provider.effect(
    ProxmoxLxc,
    Effect.succeed(ProxmoxLxc.Provider.of(handlers)).pipe(Effect.map(provingResumes)),
  );
