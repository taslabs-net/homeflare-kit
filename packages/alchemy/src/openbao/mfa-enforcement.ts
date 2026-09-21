/**
 * A login-MFA enforcement — `identity/mfa/login-enforcement/<name>`: logins through these mounts
 * (or by these groups/entities) must also pass one of these MFA methods. The machine-access plan's
 * "admin requires OpenBao login MFA" is this resource.
 *
 * ⛔ ENROL BEFORE YOU ENFORCE. A login the enforcement matches, by an entity with no secret for any
 *   listed method, FAILS (login_mfa.go validateLoginMFAInternal: "MFA secret … not present"). Enrol
 *   every admin (`identity/mfa/method/totp/admin-generate`, which RETURNS the secret — never through
 *   Alchemy) before the first deploy of this, or the admin lane locks itself out.
 * ⚠️ IT MATCHES MOUNTS, GROUPS AND ENTITIES — NEVER ROLES. An enforcement on the `jwt/` accessor
 *   covers every role on that mount (login_mfa.go buildMFAEnforcementConfigList :932-1017). To put
 *   MFA on admin only, give admin its own auth mount, or target an identity group of admins.
 * ⛔ THE DELETE IS REFUSED: IN 2.6.2 IT DOES NOT STICK. DeleteMFALoginEnforcementConfigByNameAndNamespace
 *   (login_mfa.go:1879-1902) removes the entry from memory and never from storage, so it RETURNS on the
 *   next unseal — tracked upstream as openbao/openbao#4030, open on 2026-09-21. Worse, a method
 *   deleted in between leaves the resurrected enforcement naming an id that no longer exists, and
 *   every login it matches then fails ("MFA method configuration not present", :871-877). A delete
 *   that reports success and quietly comes back is the lie this package refuses to tell. Under the
 *   default `retain` it never runs; with `destroy`, set `retain` to drop it from state and leave it
 *   live — which is what the server would do anyway.
 *
 * ★ REPLACE SEMANTICS (REPLACE.md): `name` changed → `replace`, create-first. Under `retain` BOTH
 *   enforcements then apply — fail closed. Under `destroy` the old one's delete is refused, so the
 *   deploy stops after creating. ⛔ A rename onto an enforcement that exists fails the plan
 *   (rename-identity.ts): the upsert by name would otherwise rewrite, in place, what someone else's
 *   enforcement demands. MEASURED 2026-09-21: a swap of two under `destroy` wrote each over the
 *   other, then stopped on the two refused deletes.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type { BaoError } from './bao-status.ts';
import {
  type BaoMfaLoginEnforcementAttributes,
  type BaoMfaLoginEnforcementProps,
  attributesOf,
  canonicalFromProps,
  matches,
  problems,
  writeBody,
} from './mfa-enforcement-form.ts';
import { authAccessors, enforcementPath, readEnforcement, writeEnforcement } from './mfa-wire.ts';
import { guardRename, judgeRename, nameIdentity } from './rename-identity.ts';

export type {
  BaoMfaLoginEnforcementAttributes,
  BaoMfaLoginEnforcementProps,
} from './mfa-enforcement-form.ts';

export interface BaoMfaLoginEnforcement extends Resource<
  'Bao.MfaLoginEnforcement',
  BaoMfaLoginEnforcementProps,
  BaoMfaLoginEnforcementAttributes,
  never,
  HttpClient.HttpClient
> {}

export const BaoMfaLoginEnforcement = Resource<BaoMfaLoginEnforcement>('Bao.MfaLoginEnforcement', {
  defaultRemovalPolicy: 'retain',
});

type Env = HttpClient.HttpClient;

/** Exact: the identity store indexes enforcements by (namespace, name) as given. */
const IDENTITY = nameIdentity<BaoMfaLoginEnforcementAttributes>(
  'Bao.MfaLoginEnforcement',
  enforcementPath,
);

const refuse = (name: string, message: string): Effect.Effect<never> =>
  Effect.die(new Error(`Bao.MfaLoginEnforcement ${name}: ${message}`));

/** Paths resolved to accessors, and what the declaration would be refused for. */
const resolveTargets = (props: BaoMfaLoginEnforcementProps) =>
  Effect.map(authAccessors(props.authMethodPaths ?? []), ({ accessors, missing }) => ({
    bad: problems(props, missing),
    resolved: accessors,
  }));

const readLive = (
  name: string,
): Effect.Effect<BaoMfaLoginEnforcementAttributes | undefined, BaoError, Env> =>
  Effect.map(readEnforcement(name), (live) =>
    live === undefined ? undefined : attributesOf(name, live),
  );

export const planEnforcement = (
  props: BaoMfaLoginEnforcementProps,
): Effect.Effect<'noop' | 'update', BaoError, Env> =>
  Effect.gen(function* () {
    const { bad, resolved } = yield* resolveTargets(props);
    if (bad.length > 0) return 'update';
    const live = yield* readLive(props.name);
    return live !== undefined && matches(live, props, resolved) ? 'noop' : 'update';
  });

/** Write when live differs, then prove it by reading back. */
export const reconcileEnforcement = (
  props: BaoMfaLoginEnforcementProps,
): Effect.Effect<BaoMfaLoginEnforcementAttributes, BaoError, Env> =>
  Effect.gen(function* () {
    const { bad, resolved } = yield* resolveTargets(props);
    if (bad.length > 0) return yield* refuse(props.name, bad.join('; '));
    const live = yield* readLive(props.name);
    if (live === undefined || !matches(live, props, resolved)) {
      yield* writeEnforcement(props.name, writeBody(canonicalFromProps(props, resolved)));
    }
    const after = yield* readLive(props.name);
    if (after === undefined)
      return yield* refuse(props.name, 'the write succeeded but it is absent.');
    if (!matches(after, props, resolved)) {
      return yield* refuse(props.name, 'the enforcement read back different.');
    }
    return after;
  });

export const BaoMfaLoginEnforcementProvider = () =>
  Provider.effect(
    BaoMfaLoginEnforcement,
    Effect.succeed(
      BaoMfaLoginEnforcement.Provider.of({
        /** ⛔ The namespace's enforcement listing is not a list of things this owns. */
        list: () => Effect.succeed([]),

        read: Effect.fn(function* ({ olds }) {
          return yield* readLive(olds.name);
        }),

        /** ⛔ IT COMPARES THE LIVE ENFORCEMENT — a target removed by hand is drift, not a noop. */
        diff: Effect.fn(function* ({ news, olds, output }) {
          // ⛔ The name first, before isResolved; onto an enforcement that exists fails the plan.
          const move = yield* judgeRename(IDENTITY, olds, news, output);
          if (output === undefined) return undefined;
          if (move !== undefined) return { action: 'replace' } as const;
          if (!isResolved(news)) return undefined;
          return { action: yield* planEnforcement(news) } as const;
        }),

        reconcile: Effect.fn(function* ({ news, output }) {
          // ⛔ An `update` across a rename the diff could not see — refused before any write.
          yield* guardRename(IDENTITY, news, output);
          return yield* reconcileEnforcement(news);
        }),

        /** ⛔ REFUSED — read the header: in 2.6.2 the delete does not survive a restart. */
        delete: Effect.fn(function* ({ output }) {
          return yield* refuse(
            output.name,
            'REFUSING to delete: OpenBao 2.6.2 drops a login enforcement from memory only, and it ' +
              'returns on the next unseal (openbao/openbao#4030). Set this resource back to ' +
              'retain to drop it from state; remove it for good only once the server is fixed.',
          );
        }),
      }),
    ),
  );
