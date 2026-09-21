/**
 * An OpenBao AppRole auth role — token_policies, TTLs and bind flags. METADATA ONLY.
 *
 * ⛔ NO SECRET IN PROPS OR ATTRIBUTES — see policy.ts for why. `role_id` and `secret_id`
 *   are credential issuance, not configuration, and are OUT OF SCOPE. This declares the
 *   role shape an approle login inherits — policy names and TTL strings only.
 *
 * ★ `defaultRemovalPolicy: 'retain'` — deleting a role revokes every token bound to it.
 *   Opt in with `.pipe(RemovalPolicy.destroy())`; see resource.ts in house/proxmox.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import {
  type BaoAuthRoleAttributes,
  type BaoAuthRoleProps,
  attributesOf,
  matches,
  readPath,
  writeBody,
} from './auth-role-form.ts';
import { baoDelete, baoRead, baoWrite } from './bao-http.ts';

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

        read: Effect.fn(function* ({ olds }) {
          return yield* readRole(olds);
        }),

        /**
         * ⛔ IT COMPARES THE LIVE ROLE, NOT THE STORED DIGEST. A role edited in the OpenBao
         *   UI is exactly the drift the check-* gates exist to catch.
         */
        diff: Effect.fn(function* ({ news, output }) {
          if (output === undefined || !isResolved(news)) return undefined;
          /**
           * ⛔ A RENAMED ROLE IS A NEW ROLE — NEW role_id, NEW secret_ids — SO IT IS A `replace`.
           *   Until 2026-09-21 a new `name` read nothing, planned `update` and wrote the new role,
           *   leaving the old one live under no state record: its secret_ids kept logging in for
           *   their whole TTL, and no plan would ever mention it again (REPLACE.md).
           * ⚠️ UNDER THE DEFAULT `retain` THE OLD ROLE STILL STAYS LIVE — retain keeps the old
           *   generation of a replace (Apply.ts:2164-2173). For per-host roles (host-approles.ts),
           *   opt into `RemovalPolicy.destroy()` or destroy the old role's accessors by hand.
           */
          /**
           * ⚠️ CASE-INSENSITIVELY, BECAUSE THE SERVER IS. AppRole stores `role/<lowercased name>`
           *   (approle path_role.go:1485), so `Host` → `host` is the SAME role: a `replace` there would
           *   write it, then — under `destroy` — delete the old generation, which is that same role.
           */
          if (news.name.toLowerCase() !== output.name.toLowerCase()) {
            return { action: 'replace' } as const;
          }
          const live = yield* readRole(news);
          if (live === undefined) return { action: 'update' } as const;
          if (matches(live, news)) return { action: 'noop' } as const;
          return { action: 'update' } as const;
        }),

        reconcile: Effect.fn(function* ({ news }) {
          const live = yield* readRole(news);
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
         * ⛔ DELETING A ROLE REVOKES EVERY TOKEN BOUND TO IT. Idempotent as Alchemy requires
         *   — already gone is success — but retain is the default for a reason.
         */
        delete: Effect.fn(function* ({ output }) {
          yield* baoDelete(readPath(output.name));
          return undefined;
        }),
      }),
    ),
  );
