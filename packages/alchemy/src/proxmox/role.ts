/**
 * `Proxmox.Role` — a PVE role: one name, one set of privileges. The object every other resource
 * in this package stands on, because a role is what the provision credential actually holds.
 *
 * ★ THIS IS WHERE pool.ts's ⚠️ STOPS BEING A MEMORY. Declared here, a hand edit shows up as
 *   `1 to update` rather than as a 403 six weeks later in the middle of something else.
 *
 * ⚠️ A DECLARATION REPLACES THE PRIVILEGE SET; IT DOES NOT ADD TO IT. `PUT /access/roles/{roleid}`
 *   accepts an `append` flag and this resource deliberately never sends it (role-wire.ts) — with
 *   append a role could only ever grow, the same perpetual diff by a different road. The
 *   consequence: anything a human added by hand is REVOKED on the next deploy unless it is in
 *   `privs`. Copy the live set out of `pveum role list` before declaring a role that already
 *   exists; do not type it from memory.
 *
 * ⛔ A ROLE CAN LOCK ITS OWN PROVIDER OUT, AND NOTHING IN THIS PACKAGE CAN UNDO IT. Reconcile runs
 *   as the provision credential, and that credential holds a role. Declare THAT role without the
 *   privileges the provider needs — `Sys.Modify` on `/access` above all — and the write succeeds,
 *   after which every later plan reads 403 and the repair has to happen out of band as `root@pam`
 *   over SSH.
 *
 * ⚠️ PVE REFUSES TO EDIT ITS OWN BUILT-IN ROLES (`Administrator`, `NoAccess`, the `PVE*` set), and
 *   the LIST read (below) DOES carry the `special` flag that marks them, unlike the item endpoint
 *   this file used before the distilled migration — `role-wire.ts`'s `attributesOf` does not use
 *   it, but a caller reading `list`'s own answer could. A declaration aimed at a built-in role
 *   still reads back cleanly and fails at write time. Declare roles you own.
 *
 * ★ PRIVILEGES A RECONCILE NEEDS: `Sys.Audit` on `/access` to read and diff, `Sys.Modify` on
 *   `/access` to create, update or delete. Not `Permissions.Modify` — that is a different object.
 *
 * ★ READ VIA THE LIST, NOT THE ITEM — A DELIBERATE CHANGE FROM THE PRE-MIGRATION CODE, AND THE
 *   REASON IS THE ITEM'S OWN GENERATED SCHEMA. `access.getAccessRole`'s response
 *   (`GetAccessRoleResponse`) enumerates a FIXED list of ~47 known privilege field names
 *   (`Sys_Modify`, `VM_Allocate`, …), each its own optional property — MEASURED in
 *   `@distilled.cloud/proxmox`'s generated `access.ts`. A privilege this package's generator did
 *   not know about would silently not appear as a field at all, and this file's old `privs: []`
 *   reconstruction would drop it from state without a diff ever seeing the loss. The LIST read
 *   (`access.listAccessRoles`) answers `privs` as the SAME plain comma string PVE's item read
 *   also disagreed with the index about pre-migration — a shape with no fixed enumeration to fall
 *   behind. `find` below (role-wire.ts) does the item-read's old job client-side.
 * ⚠️ REASONED, NOT MEASURED, THAT THE LIST READ NEEDS NO MORE THAN `read`'s AUDITOR SHAPE. The
 *   item read's own privilege check (`Sys.Audit` on `/access`) was measured; the list's was not
 *   separately checked, but PVE's own convention is that an index read is never MORE restrictive
 *   than its item. `readRole` stays at the default `read` on that basis, same as before.
 *
 * ★ MIGRATED OFF `client.ts`'s generic `pve()`/`pveHandlers` ONTO `@distilled.cloud/proxmox`'s
 *   typed `access.listAccessRoles`/`createAccessRole`/`putAccessRole`/`deleteAccessRole`
 *   (2026-09-24, decision 43's proxmox walk-down). `distilled-pve.ts`'s `runPve` replaces
 *   `pve()`; the cries-wolf fix is wired the same way as acl.ts, group.ts and user.ts.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as access from '@distilled.cloud/proxmox/access';
import * as Effect from 'effect/Effect';
import { guardWrite } from './distilled-guard.ts';
import {
  ROLE_CREATE,
  ROLE_UPDATE,
  attributesOf,
  createForm,
  find,
  matches,
  updateForm,
} from './role-wire.ts';
import type { PveRequirements, WithTarget } from './resource-spec.ts';
import { runPve } from './distilled-pve.ts';
import {
  UNREADABLE,
  type Unreadable,
  readOrUnreadable,
  unreadableWarning,
} from './unreadable-read.ts';

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
   * duplicates do not matter — see the header — but completeness does: this list is the
   * role, not an addition to it.
   *
   * ⚠️ DECLARE AT LEAST ONE. A role with no privileges grants nothing and reads back as an empty
   *   document, which reconcile cannot tell apart from an object that is not there.
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
 * ★ Default `read` role — see the header's ⚠️ on the list read's privilege requirement.
 * ⛔ NO `orElseSucceed` — found 2026-09-24, the same bug class as the credential denial fix. A
 *   role's absence is ALWAYS a SUCCESSFUL read (the list comes back and the role is not in it —
 *   `access.listAccessRoles` never 404s/500s per-role the way `getAccessUser`/`getAccessGroup`
 *   do, MEASURED), so this family never needed a folding/non-folding split the way user.ts and
 *   group.ts do: any THROWN failure here is genuinely unexpected and must propagate and fail the
 *   whole plan loudly, in `diff`, `read` and `reconcile` alike — never fold to "absent → update".
 */
const readRole = (props: RoleProps) =>
  readOrUnreadable(runPve(props.target, 'read', false, access.listAccessRoles({}))).pipe(
    Effect.map((rows) => {
      if (rows === UNREADABLE) return UNREADABLE;
      const row = find(rows, props.roleid);
      return row === undefined ? undefined : attributesOf(row, props);
    }),
  );

/** `read`/`reconcile` return `Attributes | undefined`; only `diff` tells `UNREADABLE` apart. */
const dropUnreadable = (live: RoleAttributes | Unreadable | undefined) =>
  live === UNREADABLE ? undefined : live;

export const ProxmoxRoleProvider = () =>
  Provider.effect(
    ProxmoxRole,
    Effect.succeed(
      ProxmoxRole.Provider.of({
        /**
         * ⛔ AN EMPTY LIST, AND NOWHERE DOES IT MATTER MORE. `GET /access/roles` returns every
         *   role on the cluster, PVE's own built-ins included. Adoption is an explicit act.
         */
        list: () => Effect.succeed([]),
        read: Effect.fn(function* ({ olds }) {
          return dropUnreadable(yield* readRole(olds));
        }),
        diff: Effect.fn(function* ({ news, output }) {
          if (!isResolved(news)) return undefined;
          yield* guardWrite(ROLE_CREATE, createForm(news), output === undefined);
          yield* guardWrite(ROLE_UPDATE, updateForm(news), false);
          if (output === undefined) return undefined;
          const live = yield* readRole(news);
          // ⛔ THE CRIES-WOLF FIX: a refused read used to fall into `undefined` below and force
          //   `update` on a role that was plainly there — see unreadable-read.ts.
          if (live === UNREADABLE) {
            yield* unreadableWarning('Proxmox.Role', news.roleid);
            return { action: 'noop' } as const;
          }
          if (live === undefined) {
            yield* guardWrite(ROLE_CREATE, createForm(news), true);
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
          const before = dropUnreadable(yield* readRole(news));
          yield* guardWrite(ROLE_CREATE, createForm(news), before === undefined);
          yield* guardWrite(ROLE_UPDATE, updateForm(news), false);
          if (before === undefined) {
            yield* runPve(
              news.target,
              'provision',
              true,
              access.createAccessRole(createForm(news)),
            );
          } else if (!matches(before, news)) {
            yield* runPve(news.target, 'provision', true, access.putAccessRole(updateForm(news)));
          }
          const after = dropUnreadable(yield* readRole(news));
          if (after === undefined) {
            return yield* Effect.die(
              new Error(
                `access/roles/${news.roleid}: the write returned no error but the role is ` +
                  'still absent. PVE wraps every answer in {"data":...} and can report success ' +
                  'on a call that did nothing -- read back rather than trusting the status code.',
              ),
            );
          }
          return after;
        }),
        /**
         * ⛔ DO NOT CARRY resource.ts's DESTROY REASSURANCE OVER TO THIS ONE. PVE does not refuse
         *   to delete a role still in use — whoever is bound to it loses those privileges the
         *   moment it goes, and the credential THIS PROVIDER runs with is bound through exactly
         *   such a binding. Checking who holds a role before removing it is an operator's job.
         */
        delete: Effect.fn(function* ({ olds }) {
          yield* runPve(
            olds.target,
            'provision',
            true,
            access.deleteAccessRole({ roleid: olds.roleid }),
          );
        }),
      }),
    ),
  );
