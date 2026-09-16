/**
 * `Proxmox.Acl` — one grant: a role bound to a subject at a path. The line that makes a role real.
 *
 * ★ USERS, GROUPS, ROLES AND TOKENS ARE ALL INERT UNTIL AN ACL BINDS THEM. A role is a named list
 *   of privileges that grants nothing by itself; a user can do nothing until
 *   {path, user|group|token, role} exists. That is what makes those four families worth declaring,
 *   and why the grants that let OpenBao mint a PVE token today are only clicks somebody made once.
 *
 * ⛔ THE ONE FAMILY THAT DOES NOT FIT `pveOperations` AS WRITTEN, AND THE MISFIT IS MEASURED. The
 *   cluster's own schema — `/pve-docs/api-viewer/apidoc.js`, read unauthenticated 2026-09-13 —
 *   lists exactly TWO methods on `/access/acl`: GET and PUT. There is no DELETE (it answers
 *   "Method 'DELETE /access/acl' not implemented") and, less famously, NO POST either. So create
 *   and update are the SAME call, `PUT /access/acl`, and removal is that PUT with `delete=1` —
 *   which is why `delete` below does not use `ops.destroy`.
 *   ⚠️ THE REAL FIX BELONGS IN `resource.ts`: give `PveSpec` a `deleteForm` and the method to go
 *     with it, and this override disappears. Until then it is local and loud — do not "restore
 *     symmetry" by pointing `delete` at `ops.destroy`, which reports every removal as a 501 while
 *     the grant stays exactly where it was.
 *
 * ⛔ A SINGLE GRANT HAS NO URL OF ITS OWN. `GET /access/acl` answers ONE FLAT LIST for the whole
 *   cluster, so identity is the tuple (path, type, ugid, roleid), matched client-side in
 *   `attributes` below. Two resources declaring the SAME tuple are the SAME grant — Alchemy sees
 *   two resource ids, not one collision — and deleting either takes the access away from both,
 *   the same hazard as two guests declaring one vmid.
 *
 * ⛔ AND THAT LIST IS FILTERED BY WHO IS ASKING. The schema's own words for GET: "The returned list
 *   is restricted to objects where you have rights to modify permissions." A credential that can
 *   read the cluster but not modify permissions is answered `[]` — not a 403, not an error — so
 *   the mount's `read` role needs permission-modify rights on the declared path exactly as
 *   `provision` does. Work reported on a grant that is plainly there means that role is too narrow.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { pve } from './client.ts';
import { type PveRequirements, type WithTarget, pveOperations } from './resource.ts';

/** PVE's three kinds of subject. The read answers this word; the write wants its plural. */
export type AclSubjectType = 'user' | 'group' | 'token';

export interface AclProps extends WithTarget {
  /**
   * The PVE object path the grant is ON — `/`, `/pool/house`, `/vms/101`, `/storage/local-zfs`.
   * ⚠️ NOT THE API PATH: `spec.path` below is the endpoint (`access/acl`). PVE's API overloads the
   *   word, so this file does too rather than renaming a field the cluster calls `path`.
   */
  path: string;
  /** Which kind of subject `ugid` names. Identity: changing it is a different grant. */
  type: AclSubjectType;
  /** `tim@pve`, `admins`, `hf-provision@pve!hf-provision-…`. Identity. */
  ugid: string;
  /** The role bound here, e.g. `PVEAuditor`. ⚠️ It must exist — PVE refuses an unknown roleid. */
  roleid: string;
  /** Inherit down the path. PVE's default is ON, and this is the grant's ONLY mutable field. */
  propagate?: boolean;
}

export interface AclAttributes {
  path: string;
  type: AclSubjectType;
  ugid: string;
  roleid: string;
  propagate: boolean;
  /**
   * ⛔ PRESENCE AS AN ATTRIBUTE, AND IT IS WHAT MAKES THE FACTORY WORK HERE. `attributes` never
   *   returns undefined: if it did, `reconcile` would take the create branch and POST to
   *   `access/acl`, which PVE does not implement. Present-but-unbound sends every write down the
   *   PUT branch instead, the only branch PVE has. The cost: the factory's read-back guard cannot
   *   fire, so `reconcile` below re-checks this field itself and dies with the same honesty.
   */
  bound: boolean;
}

export interface ProxmoxAcl extends Resource<
  'Proxmox.Acl',
  AclProps,
  AclAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxAcl = Resource<ProxmoxAcl>('Proxmox.Acl');

/**
 * ⚠️ PVE NORMALISES ACL PATHS AND RETURNS THE NORMALISED FORM, a forever-update trap when only one
 *   side of the comparison is normalised. `PVE::AccessControl::normalize_path` collapses repeated
 *   slashes and strips the trailing one, so a declared `/pool/house/` reads back as `/pool/house`
 *   and a naive match never fires again. It also refuses a path with no leading slash, so one is
 *   added here rather than letting `pool/house` 400.
 */
const normalize = (raw: string) => `/${raw.split('/').filter(Boolean).join('/')}`;

/**
 * ⚠️ THE WRITE NAMES THE SUBJECT WITH A PLURAL KEY THAT DIFFERS PER KIND — `users`, `groups`,
 *   `tokens` — while the READ answers a singular `type`/`ugid` pair. The PUT declares
 *   `additionalProperties: 0`, so `user=` fails with a 400 rather than being ignored. The bad case
 *   is the WRONG plural: a valid parameter naming a subject kind you did not mean.
 */
const SUBJECT_FIELD = { group: 'groups', token: 'tokens', user: 'users' } as const;

/** The tuple PVE keys a grant by, as the form it takes. Every write to this family starts here. */
const tuple = (props: AclProps): Record<string, string> => ({
  path: normalize(props.path),
  roles: props.roleid,
  [SUBJECT_FIELD[props.type]]: props.ugid,
});

/** Create and update are one call: the tuple plus the single mutable field. */
const bind = (props: AclProps): Record<string, string> => ({
  propagate: props.propagate === false ? '0' : '1',
  ...tuple(props),
});

/** What a change of this string means: not an edit, a different grant. Used by `diff` below. */
const identity = (grant: Pick<AclAttributes, 'path' | 'roleid' | 'type' | 'ugid'>) =>
  [normalize(grant.path), grant.type, grant.ugid, grant.roleid].join(' ');

/**
 * ⚠️ `GET /access/acl` ANSWERS AN ARRAY, while the factory hands `attributes` the
 *   `Record<string, unknown>` every other PVE read is shaped like. Rows are narrowed, not trusted,
 *   and an empty result is not evidence of an empty cluster — see the last ⛔ in the header.
 */
const find = (live: unknown, props: AclProps) =>
  (Array.isArray(live) ? live : [])
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .find(
      (row) =>
        row['path'] === normalize(props.path) &&
        row['type'] === props.type &&
        row['ugid'] === props.ugid &&
        row['roleid'] === props.roleid,
    );

/**
 * ⚠️ PVE ANSWERS `propagate` AS 1/0 RATHER THAN true/false, AND OMITS IT WHEN IT CARRIES THE API
 *   DEFAULT, WHICH IS ON. Reading an absent field as `false` would report drift on every plan,
 *   forever, for every grant this provider did not create itself.
 */
const propagates = (row: Record<string, unknown>) => {
  const value = row['propagate'];
  return value === undefined || value === 1 || value === true || value === '1';
};

const ops = pveOperations<AclProps, AclAttributes>({
  attributes: (live, props) => {
    const row = find(live, props);
    return {
      // ⚠️ `propagate` reads false when nothing is bound, because there is no grant to inherit.
      //   `bound` is the field that carries presence; this one means something only once it is set.
      bound: row !== undefined,
      path: normalize(props.path),
      propagate: row !== undefined && propagates(row),
      roleid: props.roleid,
      type: props.type,
      ugid: props.ugid,
    };
  },
  /**
   * ⛔ THE CREATE PATH IS UNREACHABLE ON A HEALTHY CLUSTER, AND ITS ERROR WILL MISLEAD YOU. The
   *   factory POSTs `collection` only when the read came back undefined, and `attributes` never
   *   does — so a POST means the GET itself failed (an expired 300s lease, a node down), not that
   *   the grant is missing. PVE answers "Method 'POST /access/acl' not implemented": read that 501
   *   as "the read failed" and go and look at the credential, not at the ACL.
   */
  /**
   * ⛔ `provision`, AND WITHOUT IT EVERY GRANT READS BACK AS ABSENT. `GET /access/acl` is
   *   FILTERED, NOT GATED — the schema's own words are "The returned list is restricted to objects
   *   where you have rights to modify permissions". A credential without Permissions.Modify gets
   *   HTTP 200 and an EMPTY ARRAY, never a 403, so there is no error for `read` to fold; it simply
   *   sees nothing.
   *   ⛔ THE READ LEASE IS EXACTLY SUCH A CREDENTIAL. `hf-read@pve` is PVEAuditor on `/`, whose
   *     privilege set is Datastore.Audit, Mapping.Audit, Pool.Audit, SDN.Audit, Sys.Audit,
   *     VM.Audit, VM.GuestAgent.Audit — MEASURED in the 2026-09-13 cluster read. No
   *     Permissions.Modify. So on the default lease all fourteen live grants read back unbound,
   *     `matches` is false for every one, the plan reports fourteen updates for grants that
   *     plainly exist, and the deploy PUTs each one before acl.ts's own read-back guard dies.
   *   ★ THIS IS THE SAME CLASS AS storage.ts, sdn-zone.ts, sdn-vnet.ts AND api-token.ts, and it is
   *     the worst instance of it: those three are gated and answer 403, which is at least an
   *     error. A filtered endpoint answers success with less data, which is indistinguishable from
   *     the object not being there.
   */
  readRole: 'provision',
  collection: () => 'access/acl',
  createForm: bind,
  /**
   * ⚠️ ONLY `propagate` IS COMPARED, AND ONLY ONCE THE GRANT IS THERE. path/type/ugid/roleid are
   *   the FILTER that produced these attributes, not a reading of the cluster: comparing them with
   *   the props they came from is true by construction. An identity change is a DIFFERENT grant,
   *   which `diff` in the provider handles.
   */
  matches: (attributes, props) =>
    attributes.bound && attributes.propagate === (props.propagate !== false),
  path: () => 'access/acl',
  updateForm: bind,
});

export const ProxmoxAclProvider = () =>
  Provider.effect(
    ProxmoxAcl,
    Effect.succeed(
      ProxmoxAcl.Provider.of({
        /**
         * ⛔ EMPTY LIKE EVERY OTHER RESOURCE HERE, AND MOST OF ALL THIS ONE. `GET /access/acl`
         *   hands back every grant a human ever clicked; adopting them would let a later plan
         *   DELETE somebody's access as tidy-up. Adoption is an explicit act.
         */
        list: () => Effect.succeed([]),
        read: Effect.fn(function* ({ olds }) {
          return yield* ops.read(olds);
        }),
        /**
         * ⛔ AN IDENTITY CHANGE IS A REPLACE, AND THE FACTORY CANNOT SAY SO ALONE — it answers
         *   `replace` only for objects with no update path, and this one has PUT. Left to delegate,
         *   editing `roleid` (or the subject, or the path) would PUT the NEW grant and LEAVE THE
         *   OLD ONE BOUND: access nobody declared, held indefinitely, invisible in the plan because
         *   the provider believes it converged. Replace makes Alchemy call `delete` with the OLD
         *   props, which is the only thing that removes it.
         *   ⚠️ CREATE-FIRST, DELIBERATELY (Alchemy's default; `deleteFirst: true` would invert it).
         *     Delete-first could remove the very grant the provision credential mints against and
         *     leave nothing able to put it back. The cost is that a NARROWING change leaves the
         *     wider grant bound until Phase 2 collects the old generation.
         */
        diff: Effect.fn(function* ({ news, output }) {
          if (output !== undefined && isResolved(news) && identity(news) !== identity(output)) {
            return { action: 'replace' } as const;
          }
          return yield* ops.diff(news, output);
        }),
        /**
         * ⚠️ THE READ-BACK GUARD, RESTORED FOR A FAMILY WHOSE "ABSENT" IS NOT `undefined`.
         *   `ops.reconcile` refuses when the object is still missing after a write, but missing
         *   here is `bound: false`, which that check cannot see. PVE answers 200 with
         *   `{"data":null}` on calls that did nothing: without this, a PUT that silently no-oped
         *   is recorded as a landed grant and the next plan reads noop over the gap.
         */
        reconcile: Effect.fn(function* ({ news }) {
          const after = yield* ops.reconcile(news);
          if (!after.bound) {
            return yield* Effect.die(
              new Error(
                `access/acl: the write returned no error but ${identity(news)} is still not ` +
                  'bound. Either the PUT did nothing, or the read credential cannot see the ' +
                  'grant -- GET /access/acl is filtered to paths you may MODIFY permissions on, ' +
                  'so a read-only role is answered [] rather than 403.',
              ),
            );
          }
          return after;
        }),
        /**
         * ⛔ NOT `ops.destroy`, AND NOT AN OVERSIGHT. `DELETE /access/acl` is not implemented, so a
         *   factory delete would fail every destroy — while looking like a permissions problem —
         *   and leave the grant bound. Removal is the create call with `delete=1` and the identity
         *   tuple, no `propagate`, because removal is keyed on the tuple and nothing else.
         *
         * ⚠️ IDEMPOTENT, AND SHARED: removing a grant that is already gone is a no-op, but the
         *   tuple is cluster-global — re-read the second ⛔ in the header before assuming this
         *   only takes away what this stack declared.
         */
        delete: Effect.fn(function* ({ olds }) {
          const removal = { delete: '1', ...tuple(olds) };
          yield* pve(olds.target, 'provision', 'PUT', 'access/acl', removal);
        }),
      }),
    ),
  );
