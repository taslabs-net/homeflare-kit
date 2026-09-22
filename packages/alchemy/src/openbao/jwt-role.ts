/**
 * A role on a `jwt` or `oidc` auth mount — `auth/<mount>/role/<name>`: which tokens may log in,
 * how the entity is named, and what the resulting OpenBao token carries. METADATA ONLY.
 *
 * ⛔ NO SECRET IN PROPS OR ATTRIBUTES — see policy.ts. A role holds claim names, audiences, redirect
 *   URIs and policy names. The mount's OIDC client secret is config, not role, and stays out of
 *   Alchemy entirely (the ⛔ in jwt-config.ts).
 * ⛔ HUMANS GET A NON-ADMIN DEFAULT (machine-access plan, "Admin boundary"): a human role's
 *   `tokenPolicies` should not include an admin policy, and admin needs login MFA
 *   (mfa-enforcement.ts). This resource does not know which policy is admin, so it cannot refuse —
 *   the stack that declares the role owns that line.
 * ⚠️ DELETING A ROLE DOES NOT REVOKE THE TOKENS IT ISSUED. path_role.go:478 pathRoleDelete removes the
 *   storage entry and nothing else; those tokens live to their TTL.
 *
 * ★ REPLACE SEMANTICS (REPLACE.md): `mount` or `name` changed → `replace`, create-first. The new
 *   path cannot collide with the old, so no `deleteFirst`. Under the default `retain` the old role
 *   stays live, and still admits logins, until removed by hand. ⛔ A move onto a role that already
 *   exists fails the plan (rename-identity.ts).
 * ★ `defaultRemovalPolicy: 'retain'`, like every Bao.* family.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { claimFor } from '../ownership/adopt.ts';
import { provingResumes } from '../ownership/resume.ts';
import { baoDelete } from './bao-http.ts';
import {
  type BaoJwtRoleAttributes,
  type BaoJwtRoleProps,
  attributesOf,
  matches,
  problems,
  rolePath,
  writeBody,
} from './jwt-role-form.ts';
import { foldName, guardRename, judgeRename, roleIdentity } from './rename-identity.ts';
import { type RoleSpec, planRole, readOwnedRole, reconcileRole } from './role-reconcile.ts';

export type {
  BaoJwtCallbackMode,
  BaoJwtRoleAttributes,
  BaoJwtRoleProps,
  BaoJwtRoleType,
} from './jwt-role-form.ts';

export interface BaoJwtRole extends Resource<
  'Bao.JwtRole',
  BaoJwtRoleProps,
  BaoJwtRoleAttributes,
  never,
  HttpClient.HttpClient
> {}

export const BaoJwtRole = Resource<BaoJwtRole>('Bao.JwtRole', {
  defaultRemovalPolicy: 'retain',
});

/**
 * The name folded, as the server keys it (`foldName`): `name` is a TypeLowerCaseString
 * (builtin/credential/jwt/path_role.go:77), so the handler reads it lowercased before it ever builds
 * `role/<name>` (:289). `App` → `app` is the same role, never a move; `problems` refuses the case.
 */
const IDENTITY = roleIdentity<BaoJwtRoleAttributes>(
  'Bao.JwtRole',
  (mount, name) => rolePath({ mount, name }),
  'jwt',
  foldName,
);

export const jwtRoleSpec = (props: BaoJwtRoleProps): RoleSpec<BaoJwtRoleAttributes> => ({
  attributesOf: (live) => attributesOf(props, live),
  body: writeBody(props),
  family: 'Bao.JwtRole',
  matches: (attributes) => matches(attributes, props),
  path: rolePath(props),
  problems: problems(props),
});

export const BaoJwtRoleProvider = () =>
  Provider.effect(
    BaoJwtRole,
    Effect.succeed(
      BaoJwtRole.Provider.of({
        /**
         * ⛔ `bao list auth/<mount>/role` IS NOT A LIST OF THINGS THIS OWNS — every role answers,
         *   including the hand-made admin lanes. Returning them invites adopt-then-delete.
         */
        list: () => Effect.succeed([]),

        /** ⛔ Stateless: `Unowned` unless our own interrupted create made it (ownership/probe.ts). */
        read: Effect.fn(function* ({ fqn, instanceId, olds, output }) {
          return yield* readOwnedRole({ fqn, instanceId, output }, jwtRoleSpec(olds));
        }),

        /** ⛔ IT COMPARES THE LIVE ROLE, NOT THE STORED DIGEST — a hand-widened audience is drift. */
        diff: Effect.fn(function* ({ news, olds, output }) {
          // ⛔ The identity first, before isResolved; onto a role that exists fails the plan.
          const move = yield* judgeRename(IDENTITY, olds, news, output);
          // ★ No attributes: an unfinished generation, proven ours or not by provingResumes.
          if (output === undefined) return undefined;
          if (move !== undefined) return { action: 'replace' } as const;
          if (!isResolved(news)) return undefined;
          return { action: yield* planRole(jwtRoleSpec(news)) } as const;
        }),

        reconcile: Effect.fn(function* ({ fqn, instanceId, news, output }) {
          // ⛔ An `update` across a move the diff could not see — refused before any write.
          yield* guardRename(IDENTITY, news, output);
          return yield* reconcileRole(jwtRoleSpec(news), claimFor({ fqn, instanceId, output }));
        }),

        /** Idempotent as Alchemy requires — a missing role deletes as success. */
        delete: Effect.fn(function* ({ output }) {
          yield* baoDelete(rolePath(output));
          return undefined;
        }),
      }),
    ).pipe(Effect.map(provingResumes)),
  );
