/**
 * An OpenBao PKI role — the policy a future issuance is checked against, and nothing else.
 *
 * ⛔ THE ROLE IS THE POLICY, NEVER THE CERTIFICATE. Nothing here touches `pki/issue/*` (which
 *   RETURNS a private key) or `pki/root/generate/*` (which CREATES one). Every value this
 *   resource stores is a domain name, a flag, a bit count or a TTL — safe to sit in Alchemy's
 *   UNENCRYPTED Postgres state. See policy.ts for why that line is load-bearing here.
 *
 * ⛔ `bao write pki/roles/<name>` REPLACES THE WHOLE ROLE — it is not a merge. OpenBao builds
 *   a fresh role entry from the request, so every field left out reverts to its SCHEMA
 *   DEFAULT. MEASURED 2026-09-13 against the live OpenBao 2.6.2, from its own
 *   `sys/internal/specs/openapi` cross-read against all eight live `pki/roles/*`, four of
 *   those defaults are WIDER than what this estate actually runs:
 *
 *     allow_ip_sans                default true                  — false on 5 of the 8 roles
 *     allow_localhost              default true                  — false on 6 of the 8
 *     allow_wildcard_certificates  default true                  — false on 6 of the 8
 *     cn_validations               default ["email","hostname"]  — ["hostname"] on 5 of the 8
 *
 *   A resource that managed only the eleven fields the brief named would therefore, on any
 *   unrelated TTL edit, silently re-open wildcards and localhost on six production roles.
 *   That is why those four are props in pki-role-form.ts though they were not in the brief,
 *   and why their default there is the CLOSED value rather than OpenBao's open one.
 *
 * ★ NARROWING IS THE FAIL-SAFE DIRECTION. A default tighter than OpenBao's can only refuse a
 *   certificate that should have been issued — loud, and cured by declaring the field. A
 *   default looser than OpenBao's issues one that should have been refused, in silence.
 *
 * ⚠️ WHAT WAS NOT MEASURED. Only reads were run against the live engine; no `bao write`
 *   happened, so nothing below is a verified round-trip. Two consequences carried into the
 *   form file: every live role has `ext_key_usage: []`, so the stored casing of a non-empty
 *   list was never observed (the compare folds case because OpenBao matches these
 *   case-insensitively at issuance); and every live role has exactly ONE allowed domain, so
 *   whether OpenBao preserves list order was never observed either (the compare sorts,
 *   because allowed_domains is a set). Both choices can only mask a cosmetic difference,
 *   never a policy one — but neither is a measurement.
 *
 * ★ `defaultRemovalPolicy: 'retain'` — see the delete comment below. Opt in with
 *   `.pipe(RemovalPolicy.destroy())`; see resource.ts in house/proxmox.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { baoDelete, baoRead, baoWrite } from './bao-http.ts';
import { mountPath, parseDuration } from './mount-form.ts';
import {
  type BaoPkiRoleAttributes,
  type BaoPkiRoleProps,
  attributesOf,
  matches,
  rolePath,
  writeBody,
} from './pki-role-form.ts';

export type { BaoPkiRoleAttributes, BaoPkiRoleProps };

export interface BaoPkiRole extends Resource<
  'Bao.PkiRole',
  BaoPkiRoleProps,
  BaoPkiRoleAttributes,
  never,
  HttpClient.HttpClient
> {}

export const BaoPkiRole = Resource<BaoPkiRole>('Bao.PkiRole', {
  defaultRemovalPolicy: 'retain',
});

const readRole = (props: BaoPkiRoleProps) =>
  Effect.gen(function* () {
    const live = yield* baoRead(rolePath(props));
    if (live === undefined) return undefined;
    return attributesOf(props, live);
  });

/** Duration props `bao write` must never see — reconcile turns these into a refusal. */
const badDurations = (props: BaoPkiRoleProps) =>
  [['ttl', props.ttl] as const, ['maxTtl', props.maxTtl] as const].filter(
    ([, text]) => parseDuration(text) === undefined,
  );

export const BaoPkiRoleProvider = () =>
  Provider.effect(
    BaoPkiRole,
    Effect.succeed(
      BaoPkiRole.Provider.of({
        /**
         * ⛔ `bao list pki/roles` IS NOT A LIST OF THINGS THIS OWNS. All eight roles in the
         *   live engine answer it, and every one of them predates this resource. Returning
         *   them would invite Alchemy to adopt — and then delete — roles it never created.
         */
        list: () => Effect.succeed([]),

        read: Effect.fn(function* ({ olds }) {
          return yield* readRole(olds);
        }),

        /**
         * ⛔ IT COMPARES A DIGEST OF THE LIVE ROLE, NOT THE STORED ONE. The attributes fed to
         *   `matches` are always freshly derived from a live read in this same operation, so
         *   a role widened by hand in the OpenBao UI still reads as drift — which is the
         *   whole reason the check-* gates exist. Comparing one digest rather than sixteen
         *   fields is also what stops a field being added to props and quietly forgotten in
         *   the comparison.
         */
        diff: Effect.fn(function* ({ news, output }) {
          if (output === undefined || !isResolved(news)) return undefined;
          /**
           * ⚠️ A ROLE IS IDENTIFIED BY MOUNT **AND** NAME. Moving a declaration to another
           *   engine is a different object under a different CA, never an in-place edit —
           *   `replace`, so Alchemy creates the new one and retires the old.
           */
          if (mountPath(news.mount ?? 'pki') !== output.mount)
            return { action: 'replace' } as const;
          /**
           * ⚠️ A DECLARATION reconcile WOULD REFUSE MUST NEVER PLAN AS noop. An empty
           *   allowedDomains, or a duration OpenBao cannot parse, can compare equal to a
           *   live role already in that state — and a noop there hides the refusal behind a
           *   clean plan until the next deploy. Route it to reconcile, which says why.
           */
          if (news.allowedDomains.length === 0 || badDurations(news).length > 0) {
            return { action: 'update' } as const;
          }
          const live = yield* readRole(news);
          if (live === undefined) return { action: 'update' } as const;
          return matches(live, news)
            ? ({ action: 'noop' } as const)
            : ({ action: 'update' } as const);
        }),

        reconcile: Effect.fn(function* ({ news }) {
          const path = rolePath(news);
          /**
           * ⛔ AN EMPTY allowedDomains IS A REFUSAL, NOT AN EMPTY ROLE. `allow_any_name` is
           *   false on every live role, so a role with no allowed domains can issue NOTHING —
           *   and an unresolved or mistyped prop reads exactly like an author who meant it.
           *   policy.ts refuses an empty fragment directory for the same reason.
           */
          if (news.allowedDomains.length === 0) {
            return yield* Effect.die(
              new Error(
                `Bao.PkiRole ${path}: allowedDomains is empty. With allow_any_name false ` +
                  'that role can issue no certificate at all.',
              ),
            );
          }
          const bad = badDurations(news);
          if (bad.length > 0) {
            return yield* Effect.die(
              new Error(
                `Bao.PkiRole ${path}: ${bad.map(([k, v]) => `${k}=${v}`).join(', ')} ` +
                  'is not a duration OpenBao parses (expect 30m, 720h, 8760h or 0).',
              ),
            );
          }
          const live = yield* readRole(news);
          if (live === undefined || !matches(live, news)) {
            yield* baoWrite('PUT', path, writeBody(news));
          }
          const after = yield* readRole(news);
          if (after === undefined) {
            return yield* Effect.die(
              new Error(`Bao.PkiRole ${path}: write reported success but the role is absent.`),
            );
          }
          /**
           * ⛔ THE WRITE IS NOT TRUSTED, IT IS RE-READ AND RE-COMPARED. A write succeeds (2xx)
           *   for a field it accepted but stored differently — the live worry being the
           *   comma-joined list values in writeBody, whose splitting is documented for
           *   allowed_domains and ext_key_usage but NOT for cn_validations. Without this
           *   check a role could land with `cn_validations: ["email,hostname"]`, report
           *   success, and then refuse every renewal at issuance time instead.
           */
          if (!matches(after, news)) {
            return yield* Effect.die(
              new Error(
                `Bao.PkiRole ${path}: wrote cleanly but the role read back different. ` +
                  'OpenBao stored something other than what was declared — inspect with ' +
                  `\`bao read ${path}\` before retrying.`,
              ),
            );
          }
          return after;
        }),

        /**
         * ⛔ DELETING A ROLE DOES NOT REVOKE THE CERTIFICATES IT ISSUED — they stay valid to
         *   their own expiry, so this is quiet now and loud much later: every renewal through
         *   the role fails once the current certificate runs out. MEASURED: the live roles
         *   carry ttl 604800 to 31536000 seconds, so the fuse on `rpi5-otel-client` is a full
         *   year. Idempotent as Alchemy requires — already gone is success — but retain is
         *   the default for exactly this reason.
         */
        delete: Effect.fn(function* ({ output }) {
          yield* baoDelete(rolePath(output));
          return undefined;
        }),
      }),
    ),
  );
