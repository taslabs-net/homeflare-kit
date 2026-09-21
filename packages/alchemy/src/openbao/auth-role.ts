/**
 * An OpenBao AppRole auth role — token_policies, TTLs and bind flags. METADATA ONLY.
 *
 * ⛔ NO SECRET IN PROPS OR ATTRIBUTES — see policy.ts for why. `role_id` and `secret_id`
 *   are credential issuance, not configuration, and are OUT OF SCOPE. This declares the
 *   role shape an approle login inherits — policy names and TTL strings only.
 *
 * ★ `defaultRemovalPolicy: 'retain'` — deleting a role locks out every host that logs in with it:
 *   its secret_ids go with it (the ⚠️ on `delete` below). Opt in with
 *   `.pipe(RemovalPolicy.destroy())`; see resource.ts in house/proxmox.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { refuseTakeover } from '../ownership/adopt.ts';
import { ownedRead } from '../ownership/probe.ts';
import { provingResumes } from '../ownership/resume.ts';
import {
  type BaoAuthRoleAttributes,
  type BaoAuthRoleProps,
  attributesOf,
  matches,
  readPath,
  writeBody,
} from './auth-role-form.ts';
import { baoDelete, baoRead, baoWrite } from './bao-http.ts';
import { foldName, guardRename, judgeRename, nameIdentity } from './rename-identity.ts';

export type { BaoAuthRoleAttributes, BaoAuthRoleProps };

export interface BaoAuthRole extends Resource<
  'Bao.AuthRole',
  BaoAuthRoleProps,
  BaoAuthRoleAttributes,
  never,
  HttpClient.HttpClient
> {}

export const BaoAuthRole = Resource<BaoAuthRole>('Bao.AuthRole', {
  defaultRemovalPolicy: 'retain',
});

/**
 * ⚠️ CASE-INSENSITIVELY, BECAUSE THE SERVER IS. AppRole stores `role/<lowercased name>` (openbao
 *   v2.6.2 builtin/credential/approle/path_role.go:1485, and roleEntry reads the same key,
 *   :1537), so `Host` → `host` is the SAME role: a `replace` there would write it, then — under
 *   `destroy` — delete the old generation, which is that same role.
 */
const IDENTITY = nameIdentity<BaoAuthRoleAttributes>('Bao.AuthRole', readPath, foldName);

const readRole = (props: BaoAuthRoleProps) =>
  Effect.gen(function* () {
    const live = yield* baoRead(readPath(props.name));
    if (live === undefined) return undefined;
    return attributesOf(props, live);
  });

export const BaoAuthRoleProvider = () =>
  Provider.effect(
    BaoAuthRole,
    Effect.succeed(
      BaoAuthRole.Provider.of({
        /**
         * ⛔ `bao list auth/approle/role` IS NOT A LIST OF THINGS THIS OWNS. Every role
         *   in the namespace answers, including break-glass and bootstrap ones. Returning
         *   them would invite Alchemy to adopt — and then delete — roles it never created.
         */
        list: () => Effect.succeed([]),

        /** ⛔ Stateless: `Unowned` unless our own interrupted create made it (ownership/probe.ts). */
        read: Effect.fn(function* ({ fqn, instanceId, olds, output }) {
          const found = yield* readRole(olds);
          const ours = Effect.sync(() => found !== undefined && matches(found, olds));
          return yield* ownedRead({ fqn, instanceId, output }, found, ours);
        }),

        /**
         * ⛔ IT COMPARES THE LIVE ROLE, NOT THE STORED DIGEST. A role edited in the OpenBao
         *   UI is exactly the drift the check-* gates exist to catch.
         */
        diff: Effect.fn(function* ({ news, olds, output }) {
          /**
           * ⛔ A RENAMED ROLE IS A NEW ROLE — NEW role_id, NEW secret_ids — SO IT IS A `replace`,
           *   judged before `isResolved(news)` (rename-identity.ts). Until 2026-09-21 a new `name`
           *   read nothing, planned `update` and wrote the new role, leaving the old one live
           *   under no state record: its secret_ids kept logging in for their whole TTL, and no
           *   plan would ever mention it again (REPLACE.md). ⛔ A rename onto a role that exists
           *   fails the plan.
           * ⚠️ UNDER THE DEFAULT `retain` THE OLD ROLE STILL STAYS LIVE — retain keeps the old
           *   generation of a replace (Apply.ts:2164-2173). For per-host roles (host-approles.ts),
           *   opt into `RemovalPolicy.destroy()` or destroy the old role's accessors by hand.
           */
          const move = yield* judgeRename(IDENTITY, olds, news, output);
          // ★ No attributes: an unfinished generation, proven ours or not by provingResumes.
          if (output === undefined) return undefined;
          if (move !== undefined) return { action: 'replace' } as const;
          if (!isResolved(news)) return undefined;
          const live = yield* readRole(news);
          if (live === undefined) return { action: 'update' } as const;
          if (matches(live, news)) return { action: 'noop' } as const;
          return { action: 'update' } as const;
        }),

        reconcile: Effect.fn(function* ({ fqn, instanceId, news, output }) {
          // ⛔ An `update` across a rename the diff could not see — refused before any write.
          yield* guardRename(IDENTITY, news, output);
          const live = yield* readRole(news);
          const path = readPath(news.name);
          if (live !== undefined)
            yield* refuseTakeover({ fqn, instanceId, output }, `Bao.AuthRole ${path}`);
          if (live === undefined || !matches(live, news)) {
            yield* baoWrite('PUT', readPath(news.name), writeBody(news));
          }
          const after = yield* readRole(news);
          if (after === undefined) {
            return yield* Effect.die(
              new Error(
                `Bao.AuthRole ${news.name}: write returned no error but the role is still absent.`,
              ),
            );
          }
          return after;
        }),

        /**
         * ⚠️ DELETING A ROLE DOES NOT REVOKE THE TOKENS IT ISSUED. openbao v2.6.2 pathRoleDelete
         *   (builtin/credential/approle/path_role.go:1858-1902) deletes every secret_id
         *   (flushRoleSecrets, validation.go:420-446), the role_id mapping and the role, so no new
         *   login succeeds, and it revokes nothing. A token already issued lives to its TTL; only
         *   its renewal fails, because pathLoginRenew (path_login.go:414-438) refuses once the role
         *   is gone. So this is not a containment action: to contain a leaked token, revoke it or
         *   its accessor. (Corrected 2026-09-21: this said the delete revoked every token.)
         * Idempotent as Alchemy requires — already gone is success — but retain is the default,
         *   because every host logging in with the role is locked out at the delete.
         */
        delete: Effect.fn(function* ({ output }) {
          yield* baoDelete(readPath(output.name));
          return undefined;
        }),
      }),
    ).pipe(Effect.map(provingResumes)),
  );
