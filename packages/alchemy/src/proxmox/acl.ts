/**
 * `Proxmox.Acl` — one grant: a role bound to a subject at a path. The line that makes a role real.
 *
 * ★ USERS, GROUPS, ROLES AND TOKENS ARE ALL INERT UNTIL AN ACL BINDS THEM. A role is a named list
 *   of privileges that grants nothing by itself; a user can do nothing until
 *   {path, user|group|token, role} exists. That is what makes those four families worth declaring,
 *   and why the grants that let OpenBao mint a PVE token today are only clicks somebody made once.
 *
 * ⛔ THE ONE FAMILY THAT DOES NOT FIT A GENERIC PATH+FORM SHAPE, AND THE MISFIT IS MEASURED. The
 *   cluster's own schema — `/pve-docs/api-viewer/apidoc.js`, read unauthenticated 2026-09-13 —
 *   lists exactly TWO methods on `/access/acl`: GET and PUT. There is no DELETE (it answers
 *   "Method 'DELETE /access/acl' not implemented") and, less famously, NO POST either — which is
 *   why `@distilled.cloud/proxmox`'s generator, reading the same schema, emits `listAccessAcl` and
 *   `putAccessAcl` and NOTHING ELSE for this path. So create and update are the SAME call, `PUT
 *   /access/acl`, and removal is that PUT with `delete=1` — there is no `destroyAccessAcl` to call.
 *
 * ⛔ A SINGLE GRANT HAS NO URL OF ITS OWN. `GET /access/acl` answers ONE FLAT LIST for the whole
 *   cluster, so identity is the tuple (path, type, ugid, roleid), matched client-side in `find`
 *   below. Two resources declaring the SAME tuple are the SAME grant — Alchemy sees two resource
 *   ids, not one collision — and deleting either takes the access away from both, the same hazard
 *   as two guests declaring one vmid.
 *
 * ⛔ AND THAT LIST IS FILTERED BY WHO IS ASKING. The schema's own words for GET: "The returned list
 *   is restricted to objects where you have rights to modify permissions." A credential that can
 *   read the cluster but not modify permissions is answered `[]` — not a 403, not an error — so
 *   the mount's `read` role needs permission-modify rights on the declared path exactly as
 *   `provision` does (below, `listAcl` reads with the `provision` role for this reason). Work
 *   reported on a grant that is plainly there means that role is too narrow.
 *
 * ★ MIGRATED OFF `client.ts`'s generic `pve()` ONTO `@distilled.cloud/proxmox`'s typed
 *   `access.listAccessAcl`/`access.putAccessAcl` (2026-09-23, decision 43's proxmox walk-down,
 *   the sub-area's first resource — ACL was already the misfit `pveOperations` could not cover
 *   cleanly, which is exactly why it goes first). `distilled-pve.ts`'s `runPve` replaces `pve()`:
 *   same lease reuse (lease-cache.ts), same cluster-member failover (members.ts), now handing the
 *   request itself to the SDK instead of a hand-assembled `HttpClientRequest`.
 *   ⛔ ONE DEAD BRANCH REMOVED, NOT PRESERVED: the old code's generic factory POSTed on a "live
 *     undefined" read, which its own header called unreachable on a healthy cluster and
 *     documented as MISLEADING — PVE has no POST here, so that 501 said nothing about the real
 *     failure. `@distilled.cloud/proxmox` has no `createAccessAcl` at all (the vendor schema has
 *     no POST to generate one from), so there is nothing to call that way. `reconcile` below
 *     always PUTs instead — the only write PVE actually implements for this path — so a read that
 *     genuinely failed now surfaces its REAL cause (a typed error, or `PveClusterExhausted`)
 *     rather than a confusing 501 from a verb that was never there.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as access from '@distilled.cloud/proxmox/access';
import * as Effect from 'effect/Effect';
import { attributesOf, bind, guardWrite, identity, matches, tuple } from './acl-wire.ts';
import type { PveRequirements, WithTarget } from './resource-spec.ts';
import { runPve } from './distilled-pve.ts';
import {
  UNREADABLE,
  type Unreadable,
  readOrUnreadable,
  unreadableWarning,
} from './unreadable-read.ts';

/** PVE's three kinds of subject. The read answers this word; the write wants its plural. */
export type AclSubjectType = 'user' | 'group' | 'token';

export interface AclProps extends WithTarget {
  /**
   * The PVE object path the grant is ON — `/`, `/pool/lab`, `/vms/101`, `/storage/local-zfs`.
   * ⚠️ NOT THE API PATH — the endpoint is fixed (`access/acl`). PVE's API overloads the word,
   *   so this file does too rather than renaming a field the cluster calls `path`.
   */
  path: string;
  /** Which kind of subject `ugid` names. Identity: changing it is a different grant. */
  type: AclSubjectType;
  /** `alice@pve`, `admins`, `hf-provision@pve!hf-provision-…`. Identity. */
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
  /** Presence, so a PUT-only family can tell "matches" from "does not exist yet" — see below. */
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
 * ⛔ `readRole: 'provision'`, WITHOUT WHICH EVERY GRANT READS BACK AS ABSENT — see the header's
 *   ⛔ on filtering.
 * ★ `readOrUnreadable` (unreadable-read.ts) runs first: a REFUSED mint of `provision` — the
 *   "cries wolf" bug — comes back `UNREADABLE` instead of the `undefined` a genuine, SUCCESSFUL
 *   read (the row simply not being in the list) produces, so `diff` below can tell them apart.
 * ⛔ NO `orElseSucceed` HERE ANY MORE — found on 2026-09-24, the SAME bug class as the credential
 *   denial: it used to fold EVERY OTHER failure (a transport error, `PveClusterExhausted`, a
 *   decode failure) into `undefined` too, which then read exactly like a genuine absence and
 *   forced the same false `update`. Only a read that actually SUCCEEDS (and the grant is not in
 *   the list it returns) may mean absent now; every other failure propagates and fails the whole
 *   plan loudly — the engine's own contract for a failed `read`/`diff` (verify.ts's `readWithState`
 *   already expects and reports it as `'failed'`).
 */
const readAttributes = (props: AclProps) =>
  readOrUnreadable(runPve(props.target, 'provision', false, access.listAccessAcl({}))).pipe(
    Effect.map((rows) => (rows === UNREADABLE ? UNREADABLE : attributesOf(rows, props))),
  );

/** `read`/`reconcile` return `Attributes | undefined`; only `diff` tells `UNREADABLE` apart. */
const dropUnreadable = (live: AclAttributes | Unreadable | undefined) =>
  live === UNREADABLE ? undefined : live;

export const ProxmoxAclProvider = () =>
  Provider.effect(
    ProxmoxAcl,
    Effect.succeed(
      ProxmoxAcl.Provider.of({
        /** ⛔ EMPTY LIKE EVERY OTHER PVE RESOURCE. Adopting every grant a human ever clicked is not adoption. */
        list: () => Effect.succeed([]),
        read: Effect.fn(function* ({ olds }) {
          return dropUnreadable(yield* readAttributes(olds));
        }),
        /**
         * ⛔ AN IDENTITY CHANGE IS A REPLACE. Editing `roleid` (or the subject, or the path) would
         *   PUT the NEW grant and LEAVE THE OLD ONE BOUND; replace makes Alchemy `delete` the old
         *   props first, the only thing that removes it. Create-first (Alchemy's default) is
         *   deliberate: delete-first could remove the very grant the provision credential mints
         *   against.
         */
        diff: Effect.fn(function* ({ news, output }) {
          if (output !== undefined && isResolved(news) && identity(news) !== identity(output)) {
            return { action: 'replace' } as const;
          }
          if (!isResolved(news)) return undefined;
          yield* guardWrite(news);
          if (output === undefined) return undefined;
          const live = yield* readAttributes(news);
          // ⛔ THE CRIES-WOLF FIX: a refused read used to fall into `undefined` below and
          //   force `update` on a grant that was plainly there — see unreadable-read.ts.
          if (live === UNREADABLE) {
            yield* unreadableWarning('Proxmox.Acl', identity(news));
            return { action: 'noop' } as const;
          }
          return live !== undefined && matches(live, news)
            ? ({ action: 'noop' } as const)
            : ({ action: 'update' } as const);
        }),
        /**
         * ⚠️ THE READ-BACK GUARD, FOR A FAMILY WHOSE "ABSENT" IS `bound: false`, NOT `undefined`.
         *   PVE answers 200 with `{"data":null}` on calls that did nothing: without this, a PUT
         *   that silently no-oped is recorded as a landed grant and the next plan reads noop over
         *   the gap.
         */
        reconcile: Effect.fn(function* ({ news }) {
          // ⚠️ `dropUnreadable`: reconcile only runs once `provision` already minted for the
          //   write below, so `UNREADABLE` here is a near-impossible race, not the routine case
          //   `diff` handles — treating it as "not yet bound" costs at most one redundant PUT.
          const before = dropUnreadable(yield* readAttributes(news));
          yield* guardWrite(news);
          if (before === undefined || !matches(before, news)) {
            yield* runPve(news.target, 'provision', true, access.putAccessAcl(bind(news)));
          }
          const after = dropUnreadable(yield* readAttributes(news));
          if (after === undefined || !after.bound) {
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
         * ⛔ NOT A DESTROY CALL — THERE IS NONE. `DELETE /access/acl` is not implemented; removal
         *   is the same PUT with `delete=1` and the identity tuple, no `propagate`, because
         *   removal is keyed on the tuple and nothing else.
         * ⚠️ IDEMPOTENT, AND CLUSTER-WIDE: removing a grant that is already gone is a no-op, but
         *   the tuple is shared — re-read the header's second ⛔ before assuming this only takes
         *   away what this stack declared.
         */
        delete: Effect.fn(function* ({ olds }) {
          const removal: access.PutAccessAclRequest = { ...tuple(olds), delete: '1' };
          yield* runPve(olds.target, 'provision', true, access.putAccessAcl(removal));
        }),
      }),
    ),
  );
