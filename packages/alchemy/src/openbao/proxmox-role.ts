/**
 * A role on the estate's proxmox secrets plugin — the mapping from one consumer to one PVE
 * mint user, plus the lease ceilings that consumer's tokens get. METADATA ONLY.
 *
 * ★ WHY THIS FAMILY MATTERS MORE THAN IT LOOKS. Declaring these roles is how the estate
 *   replaces HAND-MADE PERMANENT PVE TOKENS with short-lived minted ones. On C1, SEVEN tokens
 *   carry expire=0 and privsep=0 — root@pam!inventory-sync, agent@pve!executor,
 *   metrics@pve!exporter, app@pve!app, iac@pve!ro, iac@pve!apply and
 *   mint@pve!engine. Six of those are one Bao.ProxmoxRole plus a scoped PVE user away from
 *   being a 5-minute lease instead of a forever key.
 *
 *   The seventh cannot be. mint@pve!engine is the credential the ENGINE ITSELF
 *   authenticates with in order to mint anything at all: the thing that issues short-lived
 *   tokens needs a standing one, and no role can resolve that chicken-and-egg. It stays
 *   permanent, which makes it the single most valuable token on the cluster and the one whose
 *   rotation must be a deliberate, hand-run procedure rather than a plan.
 *
 *   MEASURED here: `bao read proxmox-c1/config` returns parent_token_id
 *   `mint@pve!engine`, parent_secret_set true, parent_secret_tail `…eb01` — the engine's
 *   own key, present and, by the schema's own "Write-only: never returned by a read", not
 *   retrievable. The seven-token inventory was handed to this change and NOT re-counted against
 *   the PVE API in this session.
 *
 * ⛔ NO SECRET IN PROPS OR ATTRIBUTES — see policy.ts for the full reasoning. Every attribute
 *   here is a mount path, a role name, a PVE username or a TTL. Nothing this resource stores
 *   would help anyone authenticate to anything.
 *
 * ⛔ ISSUANCE IS NOT THIS RESOURCE, AND MUST NEVER BECOME ONE. `<mount>/creds/<name>` returns a
 *   LIVE PVE TOKEN. Alchemy persists attributes unencrypted (StateEncoding.ts tags Redacted
 *   values rather than encrypting them) into the `alchemy` Postgres, which a nightly job dumps
 *   to a backup guest, from where PBS backs it up. A minted token declared as a resource would
 *   outlive its own lease in at least four places, none of them OpenBao. This resource declares
 *   the DOOR; walking through it is a runtime call, not a plan.
 *
 * ★ `defaultRemovalPolicy: 'retain'` — deleting a role breaks every consumer that mints from
 *   it. Opt in with `.pipe(RemovalPolicy.destroy())`; see resource.ts in <estate>/proxmox.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { refuseTakeover } from '../ownership/adopt.ts';
import { ownedRead } from '../ownership/probe.ts';
import { provingResumes } from '../ownership/resume.ts';
import { baoDelete, baoWrite } from './bao-http.ts';
import {
  type BaoProxmoxRoleAttributes,
  type BaoProxmoxRoleProps,
  matches,
  rescopeRefusal,
  rolePath,
  writeBody,
} from './proxmox-role-form.ts';
import { readRole } from './proxmox-role-wire.ts';
import { declaredString, isPendingProp } from './rename.ts';
import { guardRename, judgeRename, roleIdentity } from './rename-identity.ts';

export type { BaoProxmoxRoleAttributes, BaoProxmoxRoleProps };

export interface BaoProxmoxRole extends Resource<
  'Bao.ProxmoxRole',
  BaoProxmoxRoleProps,
  BaoProxmoxRoleAttributes,
  never,
  HttpClient.HttpClient
> {}

export const BaoProxmoxRole = Resource<BaoProxmoxRole>('Bao.ProxmoxRole', {
  defaultRemovalPolicy: 'retain',
});

/** Exact: the plugin stores `roles/<name>` verbatim. */
const IDENTITY = roleIdentity<BaoProxmoxRoleAttributes>('Bao.ProxmoxRole', rolePath);

export const BaoProxmoxRoleProvider = () =>
  Provider.effect(
    BaoProxmoxRole,
    Effect.succeed(
      BaoProxmoxRole.Provider.of({
        /**
         * ⛔ `bao list <mount>/roles` IS NOT A LIST OF THINGS THIS OWNS. MEASURED today:
         *   proxmox-c1/roles answers `provision, read` and proxmox-c2/roles answers `read` —
         *   four roles created by hand at bringup, none of them declared anywhere yet.
         *   Returning them would invite Alchemy to adopt, and then delete, roles it never
         *   created, and deleting a role is how every consumer of it stops being able to mint.
         */
        list: () => Effect.succeed([]),

        /** ⛔ Stateless: `Unowned` unless our own interrupted create made it (ownership/probe.ts). */
        read: Effect.fn(function* ({ fqn, instanceId, olds, output }) {
          const found = yield* readRole(olds);
          const ours = Effect.sync(() => found !== undefined && matches(found, olds));
          return yield* ownedRead({ fqn, instanceId, output }, found, ours);
        }),

        /**
         * ⛔ IT COMPARES THE LIVE ROLE, NOT THE STORED DIGEST. A mint_user edited in the
         *   OpenBao UI re-scopes every future credential while the digest in Postgres still
         *   says everything is fine — exactly the drift the hand-written check-* gates exist to
         *   catch, and exactly what a provider that trusted its own state would walk past.
         */
        diff: Effect.fn(function* ({ news, olds, output }) {
          /**
           * ⛔ A NEW `mount` OR `name` IS A `replace` (rename.ts). It is a DIFFERENT path, so none of
           *   the reasons below apply. Until 2026-09-21 it planned `update` and left the old role
           *   minting under no state record. Under the default `retain` the old role still mints;
           *   under `destroy` its consumers fail at the delete (REPLACE.md). ⛔ A move onto a role
           *   that already exists fails the plan (`judgeMove`).
           * ⛔ THE RE-SCOPE GUARD TRAVELS WITH THE RENAME, checked here because the new generation's
           *   reconcile finds no live role to compare. While `mintUser` or `allowMintUserChange` is
           *   still an Output it cannot be checked, so the diff defers, and reconcile refuses the
           *   resulting `update`.
           */
          const move = yield* judgeRename(IDENTITY, olds, news, output);
          // ★ No attributes: an unfinished generation, proven ours or not by provingResumes.
          if (output === undefined) return undefined;
          if (move !== undefined) {
            const mintUser = declaredString(news, 'mintUser');
            if (mintUser === undefined || isPendingProp(news, 'allowMintUserChange'))
              return undefined;
            const from = (yield* readRole(output))?.mintUser ?? output.mintUser;
            const allow = declaredString(news, 'allowMintUserChange');
            const refusal = rescopeRefusal(from, mintUser, allow);
            if (refusal === undefined) return { action: 'replace' } as const;
            return yield* Effect.die(
              new Error(`Bao.ProxmoxRole ${move.from} → ${move.to}: the rename ${refusal}`),
            );
          }
          if (!isResolved(news)) return undefined;
          const live = yield* readRole(news);
          if (live === undefined) return { action: 'update' } as const;
          if (matches(live, news)) return { action: 'noop' } as const;
          /**
           * ⛔ NEVER `replace`, NOT EVEN FOR A mint_user CHANGE. A replace deletes the role and
           *   writes it back; between those steps `<mount>/creds/<name>` 404s, so anything
           *   minting in that window fails. The end state is byte-identical to the in-place
           *   write, because the plugin stores name, mint_user, ttl and max_ttl and nothing
           *   else — there is no immutable identity a recreate could reset. So a replace here
           *   buys an outage window in exchange for a louder-looking plan. The loudness a
           *   re-scope deserves comes from reconcile REFUSING it below, which blocks rather
           *   than destroys.
           *
           * ⚠️ CONSEQUENCE FOR THE READER OF A PLAN: a mint_user re-scope shows up here as a
           *   plain `update`, indistinguishable from a TTL tweak. The refusal lands at DEPLOY,
           *   not at plan. That is the safe ordering — nothing is written before the refusal —
           *   but do not read a green plan as evidence that a mint_user change is approved.
           */
          return { action: 'update' } as const;
        }),

        reconcile: Effect.fn(function* ({ fqn, instanceId, news, output }) {
          const path = rolePath(news.mount, news.name);
          // ⛔ An `update` across a move the diff could not see — refused before any read or write.
          yield* guardRename(IDENTITY, news, output);
          const live = yield* readRole(news);
          if (live !== undefined)
            yield* refuseTakeover({ fqn, instanceId, output }, `Bao.ProxmoxRole ${path}`);
          /**
           * ⛔ A mint_user CHANGE RE-SCOPES EVERY CREDENTIAL THE ROLE WILL EVER MINT, SILENTLY.
           *   The minted token inherits that PVE user's standing ACL and nothing else, so
           *   swapping `hf-read@pve` for `hf-provision@pve` turns a read-only consumer into a
           *   provisioning one with no other line of the declaration changing. A plan diff of
           *   one string is not proportionate warning for that, so an existing role refuses the
           *   move unless the declaration NAMES THE VALUE IT IS REPLACING. Creating a role never
           *   trips this — there is nothing to re-scope — and the permission expires by itself
           *   once the change lands, because live then equals the declaration.
           * ⚠️ A RENAME CREATES A NEW ROLE, SO IT NEVER REACHES THIS CHECK. The diff asks the same
           *   question of the role being replaced (`rescopeRefusal`, proxmox-role-form.ts).
           */
          const rescope =
            live === undefined
              ? undefined
              : rescopeRefusal(live.mintUser, news.mintUser, news.allowMintUserChange);
          if (rescope !== undefined) {
            return yield* Effect.die(new Error(`Bao.ProxmoxRole ${path}: ${rescope}`));
          }
          if (live === undefined || !matches(live, news)) {
            const write = writeBody(news);
            /**
             * ⛔ AN UNPARSEABLE TTL IS A REFUSAL, NOT A ZERO. parseDuration accepts `3600s`,
             *   `1h`, `6h`, `1d` and bare `0`, and NOTHING ELSE — a bare `3600` or a compound
             *   `1h30m` returns undefined. Left alone that never equals the live value, so the
             *   plan would report an update forever and each deploy would write a zero TTL.
             *   Die with the offending props named instead.
             */
            if (!write.ok) {
              return yield* Effect.die(
                new Error(
                  `Bao.ProxmoxRole ${path}: unparseable duration ` +
                    `${write.bad.join(', ')}. Use 30s / 5m / 1h / 1d, or 0.`,
                ),
              );
            }
            yield* baoWrite('PUT', path, write.body);
          }
          const after = yield* readRole(news);
          if (after === undefined) {
            return yield* Effect.die(
              new Error(
                `Bao.ProxmoxRole ${path}: write returned no error ` +
                  'but the role is still absent.',
              ),
            );
          }
          /**
           * ⚠️ A GREEN RECONCILE DOES NOT MEAN THE ROLE CAN MINT. The engine never grants ACLs
           *   — it borrows the mint user's — so declaring `mint_user: hf-read@pve` neither
           *   creates that PVE user nor gives it a single permission. If the user does not
           *   exist, or exists with no ACL, the role writes and reads back perfectly and the
           *   failure surfaces at `creds/<name>` time, in whatever consumer is unlucky. Verify
           *   the PVE side out-of-band; this resource cannot and does not.
           */
          return after;
        }),

        /**
         * ⛔ DELETING A ROLE DOES NOT REVOKE THE TOKENS IT ALREADY MINTED — it only stops the
         *   next mint. Outstanding leases run to their own expiry against the PVE user's ACL.
         *   So this is an availability change for every consumer of `creds/<name>` and NOT a
         *   containment action: to contain a leaked credential, revoke the lease (which deletes
         *   the PVE token) or delete the token in PVE. Deleting the role only hides the door it
         *   came through. The plugin's own test pins this (homeflare-openbao-plugins,
         *   TestDeletingARoleLeavesItsOutstandingLeasesRevocable): the delete is one storage
         *   delete, and each lease stays revocable without the role.
         *
         * ⚠️ IDEMPOTENT AS ALCHEMY REQUIRES — already gone is success. It used to get that by
         *   going through `baoReadText`, which discarded the exit code entirely, so a REFUSED
         *   delete was reported as a successful one and the resource left Alchemy's state while
         *   the role stayed live. `baoDelete` keeps the idempotence — a 404 is success — and
         *   fails on everything else, 403 and 503 included.
         */
        delete: Effect.fn(function* ({ output }) {
          yield* baoDelete(rolePath(output.mount, output.name));
          return undefined;
        }),
      }),
    ).pipe(Effect.map(provingResumes)),
  );
