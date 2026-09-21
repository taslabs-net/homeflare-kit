/**
 * A role on a `kubernetes` auth mount — `auth/<mount>/role/<name>`: which service accounts may log
 * in and what their token carries. METADATA ONLY. The machine-access plan gives k8s pods this
 * instead of AppRole: one role per namespace/service account.
 *
 * ⛔ NO SECRET IN PROPS OR ATTRIBUTES — see policy.ts. The mount's own config (the cluster's CA and
 *   the token reviewer JWT) is not declared here, and the reviewer JWT must never be.
 * ⚠️ DELETING A ROLE DOES NOT REVOKE THE TOKENS IT ISSUED — pathRoleDelete removes the storage entry
 *   and nothing else (path_role.go:239-256).
 *
 * ★ REPLACE SEMANTICS (REPLACE.md): `mount` or `name` changed → `replace`, create-first (the new
 *   path cannot collide). Under the default `retain` the old role stays live until removed by hand.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { baoDelete } from './bao-http.ts';
import {
  type BaoKubernetesRoleAttributes,
  type BaoKubernetesRoleProps,
  attributesOf,
  matches,
  mountOf,
  problems,
  rolePath,
  writeBody,
} from './kubernetes-role-form.ts';
import { type RoleSpec, planRole, readRoleAt, reconcileRole } from './role-reconcile.ts';

export type {
  BaoKubernetesAliasSource,
  BaoKubernetesRoleAttributes,
  BaoKubernetesRoleProps,
} from './kubernetes-role-form.ts';

export interface BaoKubernetesRole extends Resource<
  'Bao.KubernetesRole',
  BaoKubernetesRoleProps,
  BaoKubernetesRoleAttributes,
  never,
  HttpClient.HttpClient
> {}

export const BaoKubernetesRole = Resource<BaoKubernetesRole>('Bao.KubernetesRole', {
  defaultRemovalPolicy: 'retain',
});

export const kubernetesRoleSpec = (
  props: BaoKubernetesRoleProps,
): RoleSpec<BaoKubernetesRoleAttributes> => ({
  attributesOf: (live) => attributesOf(props, live),
  body: writeBody(props),
  family: 'Bao.KubernetesRole',
  matches: (attributes) => matches(attributes, props),
  path: rolePath(props),
  problems: problems(props),
});

export const BaoKubernetesRoleProvider = () =>
  Provider.effect(
    BaoKubernetesRole,
    Effect.succeed(
      BaoKubernetesRole.Provider.of({
        /** ⛔ The mount's role listing is not a list of things this owns. */
        list: () => Effect.succeed([]),

        read: Effect.fn(function* ({ olds }) {
          const found = yield* readRoleAt(kubernetesRoleSpec(olds));
          return found?.attributes;
        }),

        /** ⛔ IT COMPARES THE LIVE ROLE, NOT THE STORED DIGEST. */
        diff: Effect.fn(function* ({ news, output }) {
          if (output === undefined || !isResolved(news)) return undefined;
          if (mountOf(news) !== output.mount || news.name !== output.name) {
            return { action: 'replace' } as const;
          }
          return { action: yield* planRole(kubernetesRoleSpec(news)) } as const;
        }),

        reconcile: Effect.fn(function* ({ news }) {
          return yield* reconcileRole(kubernetesRoleSpec(news));
        }),

        /** Idempotent as Alchemy requires — a missing role deletes as success. */
        delete: Effect.fn(function* ({ output }) {
          yield* baoDelete(rolePath(output));
          return undefined;
        }),
      }),
    ),
  );
