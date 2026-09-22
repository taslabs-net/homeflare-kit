/**
 * `Proxmox.Role` — a PVE role: one name, one set of privileges. The object every other resource
 * in this package stands on, because a role is what the provision credential actually holds.
 *
 * ★ THIS IS WHERE pool.ts's ⚠️ STOPS BEING A MEMORY. That file records, in prose, that the
 *   provision role lacked `Pool.Allocate`, that reconcile answered "Permission check failed", and
 *   that a human widened the role over SSH with `pveum role modify`. Prose cannot be planned
 *   against: it goes stale the first time somebody edits the role in the UI and tells nobody.
 *   Declared here, the same fact is a diff — the privileges the role is SUPPOSED to hold are read
 *   off the cluster on every plan, and a hand edit shows up as `1 to update` rather than as a 403
 *   six weeks later in the middle of something else.
 *
 * ⛔ THE INDEX AND THE ITEM DISAGREE ABOUT WHAT `privs` IS, AND MISSING THAT COSTS A DIFF THAT
 *   NEVER CONVERGES. `GET /access/roles` (the index) reports each role's privileges as a COMMA
 *   STRING. `GET /access/roles/{roleid}` — the path this resource reads — returns a privilege MAP
 *   instead, `{"VM.Allocate":1,"Sys.Audit":1,…}`, and its key order is a Perl hash's order, so it
 *   is not stable between two calls to the same endpoint. Compare the raw string, or the raw
 *   object, or the keys in the order they arrived, and every plan reports an update forever.
 *   `canonical` below is the whole answer: both sides become a sorted, de-duplicated set before
 *   anything is compared, and `attributes` STORES the sorted form so Alchemy's state does not
 *   churn either.
 *
 * ⚠️ A DECLARATION REPLACES THE PRIVILEGE SET; IT DOES NOT ADD TO IT. `PUT /access/roles/{roleid}`
 *   accepts an `append` flag and this resource deliberately never sends it — with append a role
 *   could only ever grow, so `matches` would report an update forever whenever props were a subset
 *   of live, which is the same perpetual diff by a different road. The consequence is the one that
 *   bites: anything a human added by hand is REVOKED on the next deploy unless it is in `privs`.
 *   Copy the live set out of `pveum role list` before declaring a role that already exists; do not
 *   type it from memory.
 *
 * ⛔ A ROLE CAN LOCK ITS OWN PROVIDER OUT, AND NOTHING IN THIS PACKAGE CAN UNDO IT. Reconcile runs
 *   as the provision credential, and that credential holds a role. Declare THAT role without the
 *   privileges the provider needs — `Sys.Modify` on `/access` above all — and the write succeeds,
 *   after which every later plan reads 403 and the repair has to happen out of band as `root@pam`
 *   over SSH. It is a one-way door, which is why the privileges a reconcile needs are written
 *   down at the bottom of this comment rather than left to be rediscovered from an error message.
 *
 * ⚠️ PVE REFUSES TO EDIT ITS OWN BUILT-IN ROLES (`Administrator`, `NoAccess`, the `PVE*` set), and
 *   the item endpoint gives no sign of which those are — only the index carries the `special`
 *   flag. A declaration aimed at a built-in role therefore READS BACK CLEANLY and fails at write
 *   time, which reads like a broken provider rather than like a refusal. Declare roles you own.
 *
 * ★ PRIVILEGES A RECONCILE NEEDS: `Sys.Audit` on `/access` to read and diff, `Sys.Modify` on
 *   `/access` to create, update or delete. Not `Permissions.Modify` — binding a role to a user is
 *   `/access/acl`, a different object, and nothing here writes it. An auditor-shaped credential
 *   can already PLAN this resource and cannot DEPLOY it, which is the honest failure: the plan is
 *   true and the deploy says exactly which privilege is missing.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';

export interface RoleProps extends WithTarget {
  /**
   * PVE's primary key for a role.
   *
   * ⚠️ THERE IS NO RENAME. `path` is built from this, so changing it makes the factory read
   *   nothing live, create a role under the new name, and leave the old one on the cluster with
   *   nobody managing it. Delete the resource and declare a new one rather than editing this.
   */
  roleid: string;
  /**
   * The COMPLETE privilege set, e.g. `['VM.Allocate', 'VM.Audit', 'Sys.Audit']`. Order and
   * duplicates do not matter — see the ⛔ in the header — but completeness does: this list is the
   * role, not an addition to it.
   *
   * ⚠️ DECLARE AT LEAST ONE. A role with no privileges grants nothing and reads back as an empty
   *   document, which is the one shape the factory cannot tell apart from an object that is not
   *   there — reconcile would then refuse with its "the write returned no error but the object is
   *   still absent" message, which is true of the read and misleading about the cause.
   */
  privs: string[];
}

export interface RoleAttributes {
  roleid: string;
  /** Sorted and de-duplicated on the way in, so persisted state is identical across plans. */
  privs: string[];
}

export interface ProxmoxRole extends Resource<
  'Proxmox.Role',
  RoleProps,
  RoleAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxRole = Resource<ProxmoxRole>('Proxmox.Role');

/**
 * The only shape two privilege sets may be compared in: sorted, de-duplicated, blanks dropped.
 *
 * ⚠️ THE TRIM AND THE EMPTY FILTER ARE NOT DECORATION. `'A,B,'.split(',')` yields a trailing `''`,
 *   and a hand-written list is quite likely to carry a stray space after a comma. Either one turns
 *   into a phantom member that no live answer can contain, so `matches` would be false on every
 *   plan and the deploy would rewrite the role to exactly what it already was.
 */
const canonical = (privs: readonly string[]): string[] =>
  [...new Set(privs.map((priv) => priv.trim()).filter((priv) => priv.length > 0))].sort();

/**
 * The privileges in a live answer, from EITHER shape PVE uses for them.
 *
 * ⚠️ THE MAP BRANCH IS THE ONE THAT RUNS HERE — the item endpoint answers `{"VM.Allocate":1,…}`,
 *   so the privilege names are the KEYS and the `1`s carry no information. The string branch
 *   exists because the index answers `{"privs":"VM.Allocate,Sys.Audit",…}` for that same role, and
 *   a reader that assumed the map shape for an index entry would compare the words `privs`,
 *   `roleid` and `special` against real privileges and report drift forever.
 *
 * ⚠️ A KEY WITH NO DOT IS NOT A PRIVILEGE. Every PVE privilege is `Category.Name` — VM.Allocate,
 *   Sys.Modify, Datastore.AllocateSpace, Pool.Audit — while the metadata PVE mixes into role
 *   answers (`special`, marking a built-in) is a bare word. Filtering on the dot keeps a flag from
 *   being diffed as though somebody had granted it.
 */
const livePrivs = (live: Record<string, unknown>): string[] => {
  const listed = live['privs'];
  if (typeof listed === 'string') return canonical(listed.split(','));
  return canonical(Object.keys(live).filter((key) => key.includes('.')));
};

const handlers = pveHandlers<RoleProps, RoleAttributes>({
  attributes: (live, props) => ({ privs: livePrivs(live), roleid: props.roleid }),
  collection: () => 'access/roles',
  /** ⚠️ PVE wants ONE comma string here, not a repeated field — `privs=A,B,C`. */
  createForm: (props) => ({ privs: canonical(props.privs).join(','), roleid: props.roleid }),
  /**
   * ⛔ NORMALISED ON BOTH SIDES, even though `attributes` already arrives sorted. This is a
   *   predicate, not a fast path: the cost of trusting one side's order is not a slow plan, it is
   *   a plan that reports an update every single time and a deploy that writes the same role back
   *   forever. Cheap insurance against the exact trap named in the header.
   */
  /** The vendor rules these forms are checked against at plan time — resource-spec.ts. */
  endpoint: { create: 'pve:POST /access/roles', update: 'pve:PUT /access/roles/{roleid}' },
  matches: (attributes, props) =>
    canonical(attributes.privs).join(',') === canonical(props.privs).join(','),
  path: (props) => `access/roles/${props.roleid}`,
  /**
   * ⚠️ NO `append` FIELD, DELIBERATELY. Sending `append=1` would make every update additive, so a
   *   privilege could be granted from here but never taken away — and a role that cannot narrow
   *   is not a declaration. See the ⚠️ in the header for what that means for hand edits.
   */
  updateForm: (props) => ({ privs: canonical(props.privs).join(',') }),
});

/**
* ⛔ AN EMPTY LIST, AND NOWHERE DOES IT MATTER MORE. `GET /access/roles` returns every
*   role on the cluster, PVE's own built-ins included. Returning them would invite Alchemy
*   to adopt `Administrator` — and therefore one day to narrow or delete it. Adoption is
*   an explicit act, here as everywhere else in this package.
 
 *
* ⛔ DO NOT CARRY THE FACTORY'S REASSURANCE OVER TO THIS ONE. `destroy` there notes that
*   PVE refuses to delete things still in use — a pool holding guests, a storage with
*   volumes — and a role is NOT protected that way. Whoever is bound to the role loses
*   those privileges the moment it goes, and the credential this provider runs with is
*   bound through exactly such a binding. Checking who holds a role before removing it is
*   an operator's job, and it is not done here on their behalf while they read a diff.
 
 */
export const ProxmoxRoleProvider = () =>
  Provider.effect(ProxmoxRole, Effect.succeed(ProxmoxRole.Provider.of(handlers)));
