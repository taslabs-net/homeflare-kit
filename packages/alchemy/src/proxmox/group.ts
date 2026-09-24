/**
 * `Proxmox.Group` — a PVE group: a name, a comment, and the set of users PVE hangs off it.
 *
 * ★ DECLARING `hf-mint` IS THE WHOLE POINT OF THIS FAMILY. `mint@pve` holds the `MintTokens` role
 *   ON THE PATH `/access/groups/hf-mint` — measured from `GET /access/acl`, 2026-09-13 — which is
 *   what confines the OpenBao proxmox engine to minting inside that one group. The group is the
 *   fence around the credential every other resource in this package runs on, and until now it was
 *   something a human typed on a node once. `user.ts` calls that account the branch it sits on;
 *   this is the branch's other end.
 *
 * ⛔ MEMBERSHIP IS NOT SETTABLE HERE, SO IT IS REPORTED AND NEVER DIFFED. Measured from the
 *   cluster's own schema: `POST /access/groups` and `PUT /access/groups/{groupid}` each accept
 *   EXACTLY `groupid` and `comment`, both with `additionalProperties: 0`. There is no members
 *   parameter to send. Membership is written from the other side — the `groups` field on each
 *   USER, which `user.ts` already owns — so `members` below is an attribute, out of `matches`,
 *   exactly like `pool.members` and `user.tokens`. Declared here it would be a diff that no write
 *   in this file could ever settle.
 *
 * ⛔ THE INDEX AND THE ITEM DISAGREE ABOUT BOTH THE NAME AND THE TYPE, and this file reads only the
 *   item. MEASURED against node-b, 2026-09-13:
 *     GET /access/groups         -> [{"groupid":"hf-mint","comment":"…",
 *                                     "users":"hf-provision@pve,hf-read@pve"}, …]
 *     GET /access/groups/hf-mint -> {"comment":"…","members":["hf-provision@pve","hf-read@pve"]}
 *   The index says `users` and hands back a COMMA STRING; the item says `members` and hands back an
 *   ARRAY. distilled's generator reflects the SAME split (`GetAccessGroupResponse.members: string[]`
 *   vs `ListAccessGroupsResponseBodyItem.users?: string`), so reading the item is what keeps this
 *   file on the array shape it already normalises.
 *
 * ⛔ AND THE ITEM'S ORDER IS NOT STABLE BETWEEN TWO CONSECUTIVE CALLS. MEASURED, seconds apart, on
 *   the same endpoint:
 *     ["root@pam","alice@pve","alice@pam","alice@example.com@corp"]
 *     ["alice@pam","alice@pve","alice@example.com@corp","root@pam"]
 *   `read_group` builds it as `[keys %{ $data->{users} }]` — a bare Perl hash key list, whose order
 *   is randomised per process — while the INDEX sorts (`join(',', sort keys …)`). So the array is
 *   sorted on the way into `attributes` as well as being kept out of `matches`: unsorted, Alchemy's
 *   stored state would churn on every read even with nothing to diff.
 *
 * ⚠️ `groupid` IS NOT ECHOED BY THE ITEM READ. Its return schema is `additionalProperties: 0` over
 *   exactly `comment` and `members`, so the id comes from props — the same arrangement, and the
 *   same reason, as `user.ts`.
 *
 * ★ PRIVILEGES: NOTHING HAD TO BE WIDENED. Measured with `pveum user permissions`, 2026-09-13:
 *     · item GET checks `['perm','/access/groups',['Sys.Audit','Group.Allocate'], any => 1]`, and
 *       `hf-read@pve` already holds `Sys.Audit` there. So `readAttributes` below reads with the
 *       default `read` role — unlike acl.ts, user.ts and api-token.ts, whose item/list reads PVE
 *       gates on an allocate privilege the 3600s read lease does not hold.
 *     · POST, PUT and DELETE each check `Group.Allocate` on `/access/groups`, and
 *       `hf-provision@pve` holds it via the provision role (`PROVISION_PRIVILEGES`).
 *
 * ⛔ `retain` BY DEFAULT, BECAUSE DELETING A GROUP DESTROYS TWO THINGS THIS FILE CANNOT PUT BACK.
 *   Measured in `PVE::AccessControl` on the node:
 *     · The member list IS the group. `user.cfg` stores it on the GROUP line and DERIVES each
 *       user's `groups` map from it at parse time. Deleting the group deletes the list, and this
 *       resource has no `members` prop to restore it from.
 *     · `delete_group_acl` then walks the whole ACL tree and drops every grant where the group is
 *       the SUBJECT. On this cluster that is `admins -> Administrator on /` and
 *       `automation -> PVEAuditor on /`: whole populations of access, gone in one call, with no
 *       confirmation and nothing in the plan to suggest it.
 *   `delete` is FULLY IMPLEMENTED — `DELETE /access/groups/{groupid}` exists — so
 *   `.pipe(RemovalPolicy.destroy())` really removes the group.
 *
 * ★ MIGRATED OFF `client.ts`'s generic `pve()`/`pveHandlers` ONTO `@distilled.cloud/proxmox`'s
 *   typed `access.getAccessGroup`/`createAccessGroup`/`putAccessGroup`/`deleteAccessGroup`
 *   (2026-09-24, decision 43's proxmox walk-down, access sub-area, second resource after Acl).
 *   `distilled-pve.ts`'s `runPve` replaces `pve()` as in acl.ts; the CRIES-WOLF FIX
 *   (unreadable-read.ts) is wired the same way: a refused `provision` mint on the WRITE-side
 *   guard, or a refused `read` mint on the plain read, reports `noop` with a warning rather than
 *   forcing `update` with nothing compared.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as access from '@distilled.cloud/proxmox/access';
import * as Effect from 'effect/Effect';
import { guardWrite } from './distilled-guard.ts';
import {
  GROUP_CREATE,
  GROUP_UPDATE,
  createForm,
  dropUnreadable,
  matches,
  readGroup,
  readGroupOrFail,
  updateForm,
} from './group-wire.ts';
import type { PveRequirements, WithTarget } from './resource-spec.ts';
import { runPve } from './distilled-pve.ts';
import { UNREADABLE, unreadableWarning } from './unreadable-read.ts';

export interface GroupProps extends WithTarget {
  /**
   * PVE's primary key for a group.
   *
   * ⚠️ THERE IS NO RENAME, AND THE FAILURE IS WORSE HERE THAN FOR A ROLE. Editing this makes `path`
   *   point at a different group, which reads as absent and is created empty — while the old group
   *   keeps its members and its ACL grants with nobody managing it. Two groups then both look
   *   right in the UI and only one of them grants anything.
   */
  groupid: string;
  /** Free text shown in the UI — the only mutable field a group has. See `storedComment` below. */
  comment?: string;
}

export interface GroupAttributes {
  groupid: string;
  comment: string;
  /**
   * Who is in the group, sorted — reported so a plan can say what a delete would strip, never
   * compared, because this endpoint cannot set it. See the two ⛔s in the header.
   */
  members: string[];
}

export interface ProxmoxGroup extends Resource<
  'Proxmox.Group',
  GroupProps,
  GroupAttributes,
  never,
  PveRequirements
> {}

/** ★ `retain` by default — a delete takes the membership and the group's grants. See the header. */
export const ProxmoxGroup = Resource<ProxmoxGroup>('Proxmox.Group', {
  defaultRemovalPolicy: 'retain',
});

export const ProxmoxGroupProvider = () =>
  Provider.effect(
    ProxmoxGroup,
    Effect.succeed(
      ProxmoxGroup.Provider.of({
        /**
         * ⛔ THE EMPTY `list` MATTERS HERE. `GET /access/groups` answers every group on the
         *   cluster, `admins` (grants `Administrator` on `/`) included. Adoption stays explicit.
         */
        list: () => Effect.succeed([]),
        // ⚠️ FOLDS ONLY WHEN `output` IS `undefined` — MEASURED 2026-09-24, an adversarial review
        //   of this very fix caught the gap. The engine calls this ONE hook from FOUR places
        //   (alchemy/src/{Plan,Apply,Drift}.ts), and only `output` tells them apart: Plan.ts's
        //   cold-start adoption probe and interrupted-create recovery, and Apply.ts's
        //   delete-recovery, all pass `output: undefined` — nothing is confirmed to exist yet, so
        //   `readGroup`'s fold is still needed there or a brand-new group could never be adopted
        //   or created. `Drift.ts` (`alchemy drift`/`sync`/`deploy --detect-drift`) is different:
        //   it calls this on an ALREADY-CONFIRMED row (`output: old.attr`, defined), exactly
        //   `diff`'s own situation below — a transient failure folded to `undefined` there is
        //   reported as `{action: 'missing'}` with NO error at all, the cries-wolf bug again, one
        //   command over. `readGroupOrFail` on that branch propagates it instead.
        read: Effect.fn(function* ({ olds, output }) {
          return dropUnreadable(
            yield* output === undefined ? readGroup(olds) : readGroupOrFail(olds),
          );
        }),
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          yield* guardWrite(GROUP_CREATE, createForm(news), output === undefined);
          yield* guardWrite(GROUP_UPDATE, updateForm(news), false);
          if (output === undefined) return undefined;
          // ⚠️ `readGroupOrFail`, NOT `readGroup` — see that function's own ⛔. A genuine
          //   TRANSIENT failure here propagates and fails the whole plan loudly instead of
          //   folding to "absent" and forcing a false update, the cries-wolf class of bug.
          const live = yield* readGroupOrFail(news);
          // ⛔ THE CRIES-WOLF FIX: a refused read used to fall into `undefined` below and force
          //   `update` on a group that was plainly there — see unreadable-read.ts.
          if (live === UNREADABLE) {
            yield* unreadableWarning('Proxmox.Group', news.groupid);
            return { action: 'noop' } as const;
          }
          if (live === undefined) {
            // Drift: state says this group exists, the cluster disagrees. reconcile recreates it.
            yield* guardWrite(GROUP_CREATE, createForm(news), true);
            return { action: 'update' } as const;
          }
          return matches(live, news)
            ? ({ action: 'noop' } as const)
            : ({ action: 'update' } as const);
        }),
        reconcile: Effect.fn(function* ({ news }) {
          // ⚠️ `dropUnreadable`: reconcile only runs once `provision` already minted for the
          //   write below (same lease-cache key), so `UNREADABLE` here is a narrow race, not the
          //   routine case `diff` handles. ⛔ UNLIKE acl.ts's PUT-only bind, a group's create is
          //   NOT idempotent the same way: if this narrow race DOES land as `undefined` while the
          //   group is genuinely already there, PVE answers "group already exists" rather than
          //   silently converging — a loud failure, not a silent duplicate.
          const before = dropUnreadable(yield* readGroup(news));
          yield* guardWrite(GROUP_CREATE, createForm(news), before === undefined);
          yield* guardWrite(GROUP_UPDATE, updateForm(news), false);
          if (before === undefined) {
            yield* runPve(
              news.target,
              'provision',
              true,
              access.createAccessGroup(createForm(news)),
            );
          } else if (!matches(before, news)) {
            yield* runPve(news.target, 'provision', true, access.putAccessGroup(updateForm(news)));
          }
          const after = dropUnreadable(yield* readGroup(news));
          if (after === undefined) {
            return yield* Effect.die(
              new Error(
                `access/groups/${news.groupid}: the write returned no error but the group is ` +
                  'still absent. PVE wraps every answer in {"data":...} and can report success ' +
                  'on a call that did nothing -- read back rather than trusting the status code.',
              ),
            );
          }
          return after;
        }),
        delete: Effect.fn(function* ({ olds }) {
          yield* runPve(
            olds.target,
            'provision',
            true,
            access.deleteAccessGroup({ groupid: olds.groupid }),
          );
        }),
      }),
    ),
  );
