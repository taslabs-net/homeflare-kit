/**
 * An OpenBao SSH secrets-engine role — `<mount>/roles/{name}`, `key_type=ca`. METADATA ONLY.
 *
 * ⛔ THE SIGNING KEY IS OUT OF SCOPE AND MUST STAY OUT. `ssh/config/ca` holds (or generates)
 *   the CA private key and `ssh/sign/<role>` issues certificates. Neither is declarable
 *   here, for the reason policy.ts spells out: Alchemy persists attributes to its state
 *   store WITHOUT encrypting them, that store is the `alchemy` Postgres, and pg-backup.sh
 *   dumps it nightly to CT100. A CA key there would outlive the vault that guards it. This
 *   resource declares the SHAPE a signature must satisfy — principals, extensions, TTLs.
 *
 * ⛔ THE ROLE WRITE IS A FULL REPLACE, NOT A PATCH. OpenBao rebuilds the role entry from the
 *   request body, so any field the write omits reverts to its ZERO value. Two things follow:
 *   `resolve` in ssh-role-form.ts fills every optional prop with the default the write would
 *   produce and `matches` compares all of it (an omitted prop asserts the default, it never
 *   means "don't care"); and `wouldErase` below names the fields this resource does NOT
 *   declare, so reconcile can REFUSE instead of quietly dropping someone's key-length floor.
 *
 * ⛔ `allowEmptyPrincipals: true` WITH AN EMPTY `allowedUsers` IS A SKELETON KEY. OpenBao
 *   will sign a certificate carrying no principals, and OpenSSH accepts such a certificate
 *   for ANY user on ANY host that trusts the CA. It defaults to false, and all three roles
 *   on the live engine carry false (MEASURED). Do not set it true without pinning
 *   `defaultCriticalOptions['force-command']` in the same declaration.
 *
 * ⛔ `ttl: '0'` DOES NOT MEAN "NO EXPIRY" AND IT DOES NOT MEAN "SHORT". It means the mount's
 *   `default_lease_ttl`, and the live `ssh` mount leaves that at 0, which means the SYSTEM
 *   default — 768h. A 32-day SSH certificate is the opposite of what an SSH CA is for.
 *   State the duration. MEASURED: the live `node-admin` and `tim` roles are ttl 14400 /
 *   max_ttl 28800 (4h / 8h); `ssh-host/roles/host` is 31536000 (365d), as a host cert should.
 *
 * ★ `defaultRemovalPolicy: 'retain'`. Deleting this role locks every operator out of the
 *   estate — the memory note "operator SSH is homeflare-bot@<host>" is this CA. Opt in with
 *   `.pipe(RemovalPolicy.destroy())`; see resource.ts in house/proxmox.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { baoDelete, baoRead, baoWrite } from './bao-http.ts';
import {
  type BaoSshRoleAttributes,
  type BaoSshRoleForm,
  type BaoSshRoleProps,
  attributesOf,
  badDurations,
  extMap,
  matches,
  readPath,
  resolve,
  writeBody,
} from './ssh-role-form.ts';

export type { BaoSshRoleAttributes, BaoSshRoleProps };

export interface BaoSshRole extends Resource<
  'Bao.SshRole',
  BaoSshRoleProps,
  BaoSshRoleAttributes,
  never,
  HttpClient.HttpClient
> {}

export const BaoSshRole = Resource<BaoSshRole>('Bao.SshRole', {
  defaultRemovalPolicy: 'retain',
});

/** Live role, plus the raw body — reconcile needs the raw half to see what it would erase. */
const readRole = (form: BaoSshRoleForm) =>
  Effect.gen(function* () {
    const live = yield* baoRead(readPath(form.mount, form.name));
    if (live === undefined) return undefined;
    return { attributes: attributesOf(form, live), live };
  });

/**
 * Fields this resource deliberately does not model, mapped to the value OpenBao's own write
 * puts there when nobody says otherwise. The templating flags change how a principal is
 * DERIVED at signing time, which is a different kind of decision from which principals
 * exist; the rest are issuance mechanics. MEASURED against all three live roles — every one
 * of them sits on exactly these values, so the guard below fires on nothing that exists.
 */
const UNMANAGED_DEFAULTS: Readonly<Record<string, unknown>> = {
  algorithm_signer: 'default',
  allow_commas_in_identity_templates: false,
  allow_user_key_ids: false,
  allowed_domains_template: false,
  allowed_users_template: false,
  default_extensions_template: false,
  default_user_template: false,
  issuer_ref: 'default',
  key_id_format: '',
  not_before_duration: 30,
};

/**
 * ⚠️ ABSENT AND EMPTY BOTH COUNT AS "NEVER SET". A role this resource wrote omits these
 *   fields entirely, so a stricter test would refuse on the provider's own output and
 *   deadlock the update after next.
 */
const isDefault = (live: Record<string, unknown>, field: string) =>
  live[field] === undefined || live[field] === '' || live[field] === UNMANAGED_DEFAULTS[field];

/**
 * ⛔ THE FIELDS A WRITE WOULD SILENTLY DESTROY. Because the write is a full replace, a role
 *   someone tuned by hand — `allowed_user_key_lengths` (a minimum RSA size), a
 *   `key_id_format` the audit trail is grepped by, a `not_before_duration` widened to
 *   survive clock skew, a non-default issuer — loses all of it the moment this resource
 *   decides to update. A vanished key-length floor is a security regression that no plan
 *   output would ever mention, and a vanished backdating window breaks signing on exactly
 *   the skewed host it was added for. So reconcile refuses instead of writing.
 */
const wouldErase = (live: Record<string, unknown>): readonly string[] => {
  const lost = Object.keys(UNMANAGED_DEFAULTS).filter((field) => !isDefault(live, field));
  if (Object.keys(extMap(live['allowed_user_key_lengths'])).length > 0) {
    lost.push('allowed_user_key_lengths');
  }
  return lost.sort();
};

const refuse = (message: string) => Effect.die(new Error(message));

export const BaoSshRoleProvider = () =>
  Provider.effect(
    BaoSshRole,
    Effect.succeed(
      BaoSshRole.Provider.of({
        /**
         * ⛔ `bao list ssh/roles` IS NOT A LIST OF THINGS THIS OWNS. Every role on the mount
         *   answers, including the break-glass ones cut by hand at bringup. Returning them
         *   would invite Alchemy to adopt — and then delete — the role that is the only way
         *   back into the estate.
         */
        list: () => Effect.succeed([]),

        read: Effect.fn(function* ({ olds }) {
          const found = yield* readRole(resolve(olds));
          return found?.attributes;
        }),

        /**
         * ⛔ IT COMPARES THE LIVE ROLE, NOT THE STORED DIGEST. A role widened in the OpenBao
         *   UI — one extra principal in `allowed_users` — is exactly the drift the check-*
         *   gates exist to catch, and a provider that trusted its own state would report
         *   `noop` straight through it.
         *
         * ⚠️ `wouldErase` is deliberately NOT consulted here. Extra hand-set fields are only
         *   at risk when something actually writes; if every managed field already matches,
         *   the honest answer is `noop` and nothing gets destroyed.
         */
        diff: Effect.fn(function* ({ news, output }) {
          if (output === undefined || !isResolved(news)) return undefined;
          const form = resolve(news);
          /**
           * ⛔ A RENAMED ROLE IS A NEW PATH, NOT AN EDIT. `ssh/roles/x` and `ssh-host/roles/x`
           *   are different mounts with different CAs. Without this, changing `name` or
           *   `mount` would write the new role and leave the old one signing certificates
           *   for as long as anyone remembered its name.
           */
          if (output.mount !== form.mount || output.name !== form.name) {
            return { action: 'replace' } as const;
          }
          const found = yield* readRole(form);
          if (found === undefined) return { action: 'update' } as const;
          return matches(found.attributes, form)
            ? ({ action: 'noop' } as const)
            : ({ action: 'update' } as const);
        }),

        reconcile: Effect.fn(function* ({ news }) {
          const form = resolve(news);
          const path = readPath(form.mount, form.name);

          const bad = badDurations(form);
          if (bad.length > 0) {
            return yield* refuse(
              `Bao.SshRole ${path}: ${bad.join(', ')} is not a duration parseDuration understands ` +
                '(`0` or `<n>s|m|h|d`). It would write, then report update on every plan forever.',
            );
          }
          /**
           * ⛔ A USER-CERT ROLE WITH NO PRINCIPALS SIGNS NOTHING. It is not dangerous — it
           *   fails closed at sign time — but it is never what was meant, and the failure
           *   surfaces hours later as "ssh stopped working" rather than here. The opposite
           *   case, empty principals that are ALLOWED, is the skeleton key in the header.
           */
          if (
            form.allowUserCertificates &&
            form.allowedUsers.length === 0 &&
            !form.allowEmptyPrincipals
          ) {
            return yield* refuse(
              `Bao.SshRole ${path}: allowUserCertificates with an empty allowedUsers and ` +
                'allowEmptyPrincipals false. Every sign request against it would be rejected.',
            );
          }

          const found = yield* readRole(form);
          if (found === undefined || !matches(found.attributes, form)) {
            if (found !== undefined) {
              const lost = wouldErase(found.live);
              if (lost.length > 0) {
                return yield* refuse(
                  `Bao.SshRole ${path}: live role carries ${lost.join(', ')}, which this ` +
                    'resource does not declare and the full-replace write would ERASE. ' +
                    'Fold those settings into the declaration, or clear them by hand first.',
                );
              }
            }
            yield* baoWrite('PUT', path, writeBody(form));
          }
          /**
           * ⚠️ RE-READ RATHER THAN ECHO THE DECLARATION. The write is the only place the
           *   JSON-string encoding of `default_extensions` could be wrong (see the ⛔ on
           *   mapValue), and a provider that returned its own props would record a role it
           *   had never confirmed.
           */
          const after = yield* readRole(form);
          if (after === undefined) {
            return yield* refuse(
              `Bao.SshRole ${path}: write returned no error but the role is still absent.`,
            );
          }
          return after.attributes;
        }),

        /**
         * ⛔ DELETING THE ROLE DOES NOT REVOKE THE CERTIFICATES IT ALREADY SIGNED. OpenSSH
         *   has no CRL here: every outstanding certificate stays valid for the rest of its
         *   TTL, on every host trusting the CA, with no way to call it back short of a KRL
         *   on each host. On the live `ssh-host` role that TTL is 365 days. Deleting is
         *   therefore a change to who gets in NEXT, never a way to lock someone out now.
         *   Idempotent as Alchemy requires — already gone is success.
         */
        delete: Effect.fn(function* ({ output }) {
          yield* baoDelete(readPath(output.mount, output.name));
          return undefined;
        }),
      }),
    ),
  );
