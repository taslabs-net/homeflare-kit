/**
 * `Proxmox.User` — a PVE account. The identity every other resource in this package borrows.
 *
 * ★ THIS IS THE ONE OBJECT THAT CAN CUT THE BRANCH IT SITS ON. The user the credential mount vends
 *   tokens for, and the group whose members are allowed to mint, are what `credentials.ts`
 *   ultimately asks OpenBao for. A cluster rebuilt without them cannot plan ANY resource here —
 *   including the plan that would recreate them, which needs a credential to run. So this resource
 *   is drift repair for an account that already exists (comment, email, enable, expire, groups),
 *   not a bootstrap: the first mint user is made on a node with `pveum user add`, by a human, once.
 *
 * ⛔ THERE IS NO `password` PROP, AND ADDING ONE WOULD BE A LEAK RATHER THAN A FEATURE. Alchemy
 *   writes resource state WITHOUT encryption — see the ⛔ in `credentials.ts` — so a password prop
 *   would sit in clear in whatever database the stack points `state` at, and in every backup of it.
 *   It is also unnecessary: `password` is accepted only by the CREATE call, changing one afterwards
 *   is `PUT /access/password` (a different endpoint, a different privilege), and an account in a
 *   realm such as `@pam`, `@ldap` or `@openid` has no PVE-side password at all — the realm holds
 *   it. Out of scope by design. `keys` (TFA) is omitted for the same reason.
 *
 * ⚠️ `groups` COMES BACK AS AN ARRAY AND GOES OUT AS A COMMA STRING, and the asymmetry is the whole
 *   trap. GET answers `["a","b"]`, POST/PUT want `a,b`, and PVE returns the list in ITS order, not
 *   the declared one. Both sides are normalised to a sorted, deduplicated set — see user-wire.ts.
 *
 * ⚠️ `tokens` IS NESTED AND IS NOT SETTABLE THROUGH THIS ENDPOINT. The read hands back a map of the
 *   account's API tokens; `PUT /access/users/{userid}` has no parameter for them, because they are
 *   their own objects under `.../token/{tokenid}` (api-token.ts). So they are reported as an
 *   attribute and kept OUT of `matches`, exactly like `pool.members`. Reported, never declared.
 *
 * ⚠️ RECONCILE NEEDS PRIVILEGES A GUEST-ONLY ROLE DOES NOT HOLD, so they are stated rather than met
 *   as a 403 in the middle of a deploy. `PROVISION_PRIVILEGES` (provision-baseline.ts) carries:
 *     · `Realm.AllocateUser` on `/access/realm/<realm>` — create and delete.
 *     · `User.Modify` on `/access/groups`, and on `/access/groups/<group>` for EVERY group named in
 *       `groups` — create, update and delete. PVE checks the groups you are granting, not just the
 *       user, so a role wide enough to edit the account can still be refused for one group.
 *     · `Sys.Audit` (or `User.Modify`) for the read, which the `read` role's auditor already has.
 *
 * ⚠️ A MISSING USER IS A 500, NOT A 404 — MEASURED against the live cluster, "no such user
 *   ('x@pve')". The first SDK migration exposed it as `InternalServerError`, so its create
 *   workflow needed a catch-all fold. SDK PR #265 now recognizes `UserNotFound`; `readUser`
 *   catches only that tag, letting other cold-read/reconcile failures propagate. The strict
 *   `readUserOrFail` path for confirmed rows remains unchanged: its original transient-failure
 *   fix stopped the cries-wolf update with nothing compared (user-wire.ts).
 *
 * ⚠️ THE WIRE URL FOR THIS FAMILY CHANGED, THOUGH NOTHING A CALLER SEES DID. MEASURED
 *   (user.test.ts): distilled's `{userid}` label substitution percent-encodes it —
 *   `iac@pve` -> `.../access/users/iac%40pve` — where `client.ts`'s plain string concatenation
 *   sent the `@` literally. A real PVE (any HTTP server) decodes both the same way, so this is
 *   not a behaviour change a stack observes; a fake in a test has to decode it, `client.ts`'s
 *   own fixtures never had to.
 *
 * ★ MIGRATED OFF `client.ts`'s generic `pve()`/`pveHandlers` ONTO `@distilled.cloud/proxmox`'s
 *   typed `access.getAccessUser`/`createAccessUser`/`putAccessUser`/`deleteAccessUser`
 *   (2026-09-24, decision 43's proxmox walk-down, access sub-area). `distilled-pve.ts`'s `runPve`
 *   replaces `pve()` as in acl.ts and group.ts; the cries-wolf fix is wired the same way.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as access from '@distilled.cloud/proxmox/access';
import * as Effect from 'effect/Effect';
import { guardWrite } from './distilled-guard.ts';
import type { PveRequirements, WithTarget } from './resource-spec.ts';
import { runPve } from './distilled-pve.ts';
import { UNREADABLE, unreadableWarning } from './unreadable-read.ts';
import {
  USER_CREATE,
  USER_UPDATE,
  createForm,
  dropUnreadable,
  matches,
  readUser,
  readUserOrFail,
  updateForm,
} from './user-wire.ts';

export interface UserProps extends WithTarget {
  /**
   * ⛔ REALM-QUALIFIED, ALWAYS: `someone@pve`, `someone@pam`. The realm is part of PVE's primary
   *   key, and a bare name is refused with "value does not look like a valid user id".
   *
   * ⚠️ PVE HAS NO RENAME. Editing this prop makes the path point at a DIFFERENT account, which
   *   reads as absent and is then created — while the old one stays on the cluster with its tokens
   *   and its ACL entries. Renaming is a delete and a create, and should be declared as one.
   */
  userid: string;
  /** Free text shown in the UI. */
  comment?: string;
  /** PVE accepts the empty string here; that is how an address is cleared. */
  email?: string;
  /** Default true, matching PVE's own `enable=1`. False disables login without deleting anything. */
  enable?: boolean;
  /** Seconds since the epoch. 0 — the default — means the account never expires. */
  expire?: number;
  /** Group memberships. Order and duplicates carry no meaning — see the ⚠️ in the header. */
  groups?: string[];
  firstname?: string;
  lastname?: string;
}

export interface UserAttributes {
  userid: string;
  comment: string;
  email: string;
  enable: boolean;
  expire: number;
  /** Normalised: sorted, deduplicated, whatever shape the cluster used on the wire. */
  groups: string[];
  firstname: string;
  lastname: string;
  /**
   * API token names this account owns. Reported so a plan can show what a delete would revoke;
   * never compared, because this endpoint cannot set them.
   */
  tokens: string[];
}

export interface ProxmoxUser extends Resource<
  'Proxmox.User',
  UserProps,
  UserAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxUser = Resource<ProxmoxUser>('Proxmox.User');

export const ProxmoxUserProvider = () =>
  Provider.effect(
    ProxmoxUser,
    Effect.succeed(
      ProxmoxUser.Provider.of({
        /**
         * ⛔ EMPTY, AND MORE POINTEDLY SO HERE THAN ANYWHERE ELSE. `GET /access/users` answers
         *   with every account on the cluster: `root@pam`, every human who logs in, every service
         *   identity someone made years ago. Adoption is an explicit act.
         */
        list: () => Effect.succeed([]),
        // ⚠️ FOLDS ONLY WHEN `output` IS `undefined` — MEASURED 2026-09-24, an adversarial review
        //   of this very fix caught the gap. The engine calls this ONE hook from FOUR places
        //   (alchemy/src/{Plan,Apply,Drift}.ts), and only `output` tells them apart: Plan.ts's
        //   cold-start adoption probe and interrupted-create recovery, and Apply.ts's
        //   delete-recovery, all pass `output: undefined` — nothing is confirmed to exist yet, so
        //   `readUser`'s fold is still needed there or a brand-new account could never be adopted
        //   or created. `Drift.ts` (`alchemy drift`/`sync`/`deploy --detect-drift`) is different:
        //   it calls this on an ALREADY-CONFIRMED row (`output: old.attr`, defined), exactly
        //   `diff`'s own situation below — a transient failure folded to `undefined` there is
        //   reported as `{action: 'missing'}` with NO error at all, the cries-wolf bug again, one
        //   command over. `readUserOrFail` on that branch propagates it instead.
        read: Effect.fn(function* ({ olds, output }) {
          return dropUnreadable(
            yield* output === undefined ? readUser(olds) : readUserOrFail(olds),
          );
        }),
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          yield* guardWrite(USER_CREATE, createForm(news), output === undefined);
          yield* guardWrite(USER_UPDATE, updateForm(news), false);
          if (output === undefined) return undefined;
          // ⚠️ `readUserOrFail`, NOT `readUser` — see that function's own header (user-wire.ts).
          //   A genuine failure here propagates and fails the whole plan loudly instead of
          //   folding to "absent" and forcing a false update, the cries-wolf class of bug.
          const live = yield* readUserOrFail(news);
          // ⛔ THE CRIES-WOLF FIX: a refused read used to fall into `undefined` below and force
          //   `update` on an account that was plainly there — see unreadable-read.ts.
          if (live === UNREADABLE) {
            yield* unreadableWarning('Proxmox.User', news.userid);
            return { action: 'noop' } as const;
          }
          if (live === undefined) {
            yield* guardWrite(USER_CREATE, createForm(news), true);
            return { action: 'update' } as const;
          }
          return matches(live, news)
            ? ({ action: 'noop' } as const)
            : ({ action: 'update' } as const);
        }),
        reconcile: Effect.fn(function* ({ news }) {
          // ⚠️ `dropUnreadable`: reconcile only runs once `provision` already minted for the
          //   write below, so `UNREADABLE` here is a narrow race, not the routine case `diff`
          //   handles — and a wrongful create in that race fails loudly ("already exists")
          //   rather than silently duplicating, group.ts's reconcile has the same note.
          const before = dropUnreadable(yield* readUser(news));
          yield* guardWrite(USER_CREATE, createForm(news), before === undefined);
          yield* guardWrite(USER_UPDATE, updateForm(news), false);
          if (before === undefined) {
            yield* runPve(
              news.target,
              'provision',
              true,
              access.createAccessUser(createForm(news)),
            );
          } else if (!matches(before, news)) {
            yield* runPve(news.target, 'provision', true, access.putAccessUser(updateForm(news)));
          }
          const after = dropUnreadable(yield* readUser(news));
          if (after === undefined) {
            return yield* Effect.die(
              new Error(
                `access/users/${news.userid}: the write returned no error but the account is ` +
                  'still absent. PVE wraps every answer in {"data":...} and can report success ' +
                  'on a call that did nothing -- read back rather than trusting the status code.',
              ),
            );
          }
          return after;
        }),
        /**
         * ⛔ DELETING A USER TAKES ITS API TOKENS AND ITS ACL ENTRIES WITH IT, in one call and
         *   without a confirmation. For the identity a credential mount vends from, that revokes
         *   every outstanding lease at once and every plan in this package stops working — this
         *   one included. PVE refuses only for `root@pam`; for everyone else it simply obeys.
         */
        delete: Effect.fn(function* ({ olds }) {
          yield* runPve(
            olds.target,
            'provision',
            true,
            access.deleteAccessUser({ userid: olds.userid }),
          );
        }),
      }),
    ),
  );
