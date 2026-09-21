/**
 * A role on one of the six Cloudflare secrets-engine mounts — what one consumer may mint: the
 * Cloudflare policy its tokens carry and the lease bounds they get. METADATA ONLY.
 *
 * ★ THE PORT OF apply-roles.py's WRITE. roles.yaml expands to these (cloudflare-roles-expand.ts),
 *   and what used to be `bao write <mount>/roles/<name> ttl= max_ttl= description= policies=` is
 *   reconcile below. The props name permission groups; CloudflarePermissionGroups turns them into
 *   IDs at diff and reconcile time.
 *
 * ⛔ NO SECRET IN PROPS OR ATTRIBUTES — see cloudflare-role-form.ts. ⛔ AND ISSUANCE IS NOT THIS
 *   RESOURCE: `<mount>/creds/<name>` returns a LIVE Cloudflare token, and a token declared as a
 *   resource would outlive its lease in Alchemy's unencrypted state (proxmox-role.ts has the four
 *   places it would land). This declares the door; minting is a runtime call.
 *
 * ★ `defaultRemovalPolicy: 'retain'` — deleting a role breaks every consumer that mints from it,
 *   and apply-roles.py never deleted one either: an unexplained role was reported UNTRACKED and
 *   left alone (apply-roles.py:190-196). Opt in with `.pipe(RemovalPolicy.destroy())`.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { groupKey, scopeOfResource } from './cloudflare-group-scope.ts';
import { CloudflarePermissionGroups, type GroupRef } from './cloudflare-permission-groups.ts';
import { resolvePolicies } from './cloudflare-policy.ts';
import {
  type BaoCloudflareRoleAttributes,
  type BaoCloudflareRoleProps,
  attributesOf,
  differences,
  refusalOf,
  rolePath,
  writeBody,
} from './cloudflare-role-form.ts';
import {
  deleteCloudflareRole,
  readCloudflareRole,
  writeCloudflareRole,
} from './cloudflare-role-wire.ts';
import {
  declaredRolePath,
  isMoved,
  judgeMove,
  refuseMovedUpdate,
  triedRolePath,
} from './rename.ts';

export type { BaoCloudflareRoleAttributes, BaoCloudflareRoleProps };

/**
 * ⚠️ CloudflarePermissionGroups IS NOT A REQUIREMENT OF THE RESOURCE. The provider takes it once, when
 *   it is built (`yield* CloudflarePermissionGroups` below), and alchemy.run.ts supplies it to the
 *   provider layer with `Layer.provide`. Listing it here as well made it a requirement of the STACK
 *   body, which Alchemy only lets name its own provider and stack services — tsc refused the wiring.
 */
export interface BaoCloudflareRole extends Resource<
  'Bao.CloudflareRole',
  BaoCloudflareRoleProps,
  BaoCloudflareRoleAttributes,
  never,
  HttpClient.HttpClient
> {}

export const BaoCloudflareRole = Resource<BaoCloudflareRole>('Bao.CloudflareRole', {
  defaultRemovalPolicy: 'retain',
});

export const BaoCloudflareRoleProvider = () =>
  Provider.effect(
    BaoCloudflareRole,
    Effect.gen(function* () {
      const groups = yield* CloudflarePermissionGroups;

      /**
       * The declaration with IDs. ⛔ A name that does not resolve fails here — never a guess.
       *
       * ⛔ ONE REF PER (NAME, SCOPE), NOT PER NAME. The entry's resource is what says which scope
       *   its groups are gated at, so a role whose zone entry and account entry name one group asks
       *   for both ids; deduplicating by name alone would ask for one and use it for both.
       */
      const resolved = (props: BaoCloudflareRoleProps) =>
        Effect.gen(function* () {
          const refs = new Map<string, GroupRef>();
          for (const policy of props.policies) {
            /** ⛔ THE SAME PREFERENCE resolvePolicies MAKES — ask for the id the entry will use. */
            const scope = policy.scope ?? scopeOfResource(policy.resource);
            for (const name of policy.groups) refs.set(groupKey(name, scope), { name, scope });
          }
          const ids = yield* groups.resolve(props.mount, [...refs.values()]);
          const { missing, policies } = resolvePolicies(props.policies, ids);
          if (missing.length > 0) {
            return yield* Effect.die(
              new Error(
                `Bao.CloudflareRole ${rolePath(props.mount, props.name)}: groups ` +
                  `${missing.join(', ')} came back unresolved from a lookup that reported success.`,
              ),
            );
          }
          return policies;
        });

      return BaoCloudflareRole.Provider.of({
        /**
         * ⛔ `<mount>/roles` IS NOT A LIST OF THINGS THIS OWNS. MEASURED 2026-09-14: 586 live roles,
         *   585 of which roles.yaml declares — and the 586th, cloudflare-<account>-platform/
         *   alchemy-os-create, is exactly the role nobody has decided about. Returning it would
         *   invite Alchemy to adopt, then delete, a role that may be someone's live credential.
         */
        list: () => Effect.succeed([]),

        read: Effect.fn(function* ({ olds }) {
          const live = yield* readCloudflareRole(olds.mount, olds.name);
          return live === undefined ? undefined : attributesOf(olds, live);
        }),

        /**
         * ⛔ IT COMPARES THE LIVE ROLE, NOT THE STORED DIGEST. A policy widened by hand in the
         *   OpenBao UI changes what every future token can do while the digest in Postgres still
         *   says everything is fine.
         *
         * ⛔ A NEW `mount` OR `name` IS A `replace`, DECIDED BEFORE ANY OTHER READ (rename.ts). Until
         *   2026-09-21 this read the new path, found it absent and planned `update`: reconcile wrote
         *   the new role and the old one stayed live and mintable under no state record. ⛔ A move
         *   onto a role that already exists fails the plan (`judgeMove`).
         * ⚠️ UNDER THE DEFAULT `retain` THE OLD ROLE STILL MINTS for any token whose policy reaches its
         *   `creds/<name>`. Under `destroy` every consumer still minting from the old path fails at
         *   the delete, so move them in the same PR (REPLACE.md).
         * ★ A STACK THAT PUTS mount AND name IN THE LOGICAL ID never reaches this branch
         *   (homeflare-openbao's declareCloudflareRoles does). There a rename is a new logical id,
         *   and the old id leaves the stack as an orphan delete, which `retain` keeps live.
         */
        diff: Effect.fn(function* ({ news, olds, output }) {
          const tried = triedRolePath(output, olds, rolePath);
          const declared = declaredRolePath(news, rolePath);
          const move = yield* judgeMove('Bao.CloudflareRole', tried, declared, (path) => path);
          if (output === undefined) return undefined;
          if (move !== undefined) return { action: 'replace' } as const;
          if (!isResolved(news)) return undefined;
          /**
           * ⚠️ A DECLARATION reconcile WOULD REFUSE MUST NEVER PLAN AS noop — route it to reconcile,
           *   which says why (pki-role.ts has the same guard).
           */
          if (refusalOf(news) !== undefined) return { action: 'update' } as const;
          const policies = yield* resolved(news);
          const live = yield* readCloudflareRole(news.mount, news.name);
          if (live === undefined) return { action: 'update' } as const;
          return differences(news, policies, live).length === 0
            ? ({ action: 'noop' } as const)
            : ({ action: 'update' } as const);
        }),

        reconcile: Effect.fn(function* ({ news, output }) {
          const path = rolePath(news.mount, news.name);
          // ⛔ An `update` across a move the diff could not see — refused before any write.
          const before = output === undefined ? path : rolePath(output.mount, output.name);
          if (isMoved(before, path) === true) {
            return yield* refuseMovedUpdate('Bao.CloudflareRole', before, path);
          }
          const refusal = refusalOf(news);
          if (refusal !== undefined) {
            return yield* Effect.die(new Error(`Bao.CloudflareRole ${path}: ${refusal}.`));
          }
          const policies = yield* resolved(news);
          const live = yield* readCloudflareRole(news.mount, news.name);
          /**
           * ⛔ ADOPTING A ROLE THAT ALREADY MATCHES MUST NOT REWRITE IT. Alchemy's `adopted` action
           *   routes through reconcile (policy.ts has the Apply.ts reading), so without this guard
           *   the first deploy would PUT all 585 roles — byte-identical in the happy case, and a
           *   silent rewrite of live grants the moment the port disagreed with production.
           */
          if (live === undefined || differences(news, policies, live).length > 0) {
            yield* writeCloudflareRole(news.mount, news.name, writeBody(news, policies));
          }
          const after = yield* readCloudflareRole(news.mount, news.name);
          if (after === undefined) {
            return yield* Effect.die(
              new Error(`Bao.CloudflareRole ${path}: the write succeeded but the role is absent.`),
            );
          }
          /**
           * ⛔ THE WRITE IS NOT TRUSTED, IT IS RE-READ. The engine re-marshals `policies` from structs
           *   (path_roles.go:199-207), so a document it stored differently from what was sent — a
           *   dropped group, a merged resource — shows up here as a named field, not as a green
           *   deploy followed by a 403 at mint time.
           */
          const left = differences(news, policies, after);
          if (left.length > 0) {
            return yield* Effect.die(
              new Error(
                `Bao.CloudflareRole ${path}: wrote cleanly but reads back different in ` +
                  `${left.map((d) => d.field).join(', ')}. Inspect the role before retrying.`,
              ),
            );
          }
          return attributesOf(news, after);
        }),

        /**
         * ⛔ DELETING A ROLE DOES NOT REVOKE THE TOKENS IT MINTED. They are leases on Cloudflare API
         *   tokens and live to their own expiry, so this is an availability change for every
         *   consumer of `creds/<name>`, never a containment action — to contain a leak, revoke the
         *   lease. Idempotent: already gone is success (bao-status.ts).
         */
        delete: Effect.fn(function* ({ output }) {
          yield* deleteCloudflareRole(output.mount, output.name);
          return undefined;
        }),
      });
    }),
  );
