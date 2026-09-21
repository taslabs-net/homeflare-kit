/**
 * A TOTP login-MFA method — `identity/mfa/method/totp`, found by `method_name`. The method is
 * policy only: issuer, period, digits. Its `methodId` is what a Bao.MfaLoginEnforcement names.
 *
 * ⛔ A RENAME IS REFUSED, NOT REPLACED. A new name is a new method with a new id, and every entity's
 *   enrolled secret belongs to the OLD id (login_mfa.go validateTOTP reads `entity.MFASecrets[id]`).
 *   The enforcement would follow the new id in the same deploy, and every enrolled admin would then
 *   fail MFA — with nobody left able to log in and re-enrol them. The safe move is additive: declare
 *   the new method as a SECOND resource, list both ids on the enforcement (any one method passes,
 *   login_mfa.go:831-858), enrol everyone, then drop the old one.
 * ⛔ DELETING THE METHOD DESTROYS EVERY ENROLLED SECRET FOR IT (mfa-wire.ts deleteTotp) — and with
 *   openbao/openbao#4030, a deleted enforcement can come back after a restart still naming this id,
 *   failing every login it matches. `retain` is the default for exactly that reason.
 *
 * ★ REPLACE SEMANTICS (REPLACE.md): never `replace`. `name` changed → the plan FAILS (above); any
 *   other field is an in-place `update`, because the upsert keeps the id.
 */
import { Resource } from 'alchemy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { type Claim, claimFor } from '../ownership/adopt.ts';
import { ownedRead } from '../ownership/probe.ts';
import { noteResume } from '../ownership/resume.ts';
import type { BaoError } from './bao-status.ts';
import {
  type BaoMfaTotpMethodAttributes,
  type BaoMfaTotpMethodProps,
  attributesOf,
  matches,
  problems,
  renameProblem,
  writeBody,
} from './mfa-totp-form.ts';
import { deleteTotp, findTotp, writeTotp } from './mfa-wire.ts';
import { declaredString } from './rename.ts';

export type {
  BaoMfaTotpMethodAttributes,
  BaoMfaTotpMethodProps,
  BaoTotpAlgorithm,
} from './mfa-totp-form.ts';

export interface BaoMfaTotpMethod extends Resource<
  'Bao.MfaTotpMethod',
  BaoMfaTotpMethodProps,
  BaoMfaTotpMethodAttributes,
  never,
  HttpClient.HttpClient
> {}

export const BaoMfaTotpMethod = Resource<BaoMfaTotpMethod>('Bao.MfaTotpMethod', {
  defaultRemovalPolicy: 'retain',
});

const refuse = (name: string, message: string): Effect.Effect<never> =>
  Effect.die(new Error(`Bao.MfaTotpMethod ${name}: ${message}`));

export const readTotp = (
  props: BaoMfaTotpMethodProps,
): Effect.Effect<BaoMfaTotpMethodAttributes | undefined, BaoError, HttpClient.HttpClient> =>
  Effect.map(findTotp(props.name), (found) =>
    found === undefined ? undefined : attributesOf(found.id, found.live),
  );

export const planTotp = (
  props: BaoMfaTotpMethodProps,
): Effect.Effect<'noop' | 'update', BaoError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    if (problems(props).length > 0) return 'update';
    const live = yield* readTotp(props);
    return live !== undefined && matches(live, props) ? 'noop' : 'update';
  });

/**
 * Upsert by name when live differs, then prove it by reading back.
 * ⛔ `claim` (the provider passes it): a create never takes over a method it finds by that name.
 */
export const reconcileTotp = (
  props: BaoMfaTotpMethodProps,
  claim?: Claim,
): Effect.Effect<BaoMfaTotpMethodAttributes, BaoError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const bad = problems(props);
    if (bad.length > 0) return yield* refuse(props.name, bad.join('; '));
    const live = yield* readTotp(props);
    if (live !== undefined && claim !== undefined) yield* claim(`Bao.MfaTotpMethod ${props.name}`);
    if (live === undefined || !matches(live, props)) yield* writeTotp(writeBody(props));
    const after = yield* readTotp(props);
    if (after === undefined)
      return yield* refuse(props.name, 'the write succeeded but no method has that name.');
    if (!matches(after, props)) return yield* refuse(props.name, 'the method read back different.');
    return after;
  });

export const BaoMfaTotpMethodProvider = () =>
  Provider.effect(
    BaoMfaTotpMethod,
    Effect.succeed(
      BaoMfaTotpMethod.Provider.of({
        /** ⛔ The namespace's method listing is not a list of things this owns. */
        list: () => Effect.succeed([]),

        /** ⛔ Stateless: `Unowned` unless our own interrupted create made it (ownership/probe.ts). */
        read: Effect.fn(function* ({ fqn, instanceId, olds, output }) {
          const found = yield* readTotp(olds);
          const ours = Effect.sync(
            () => found !== undefined && problems(olds).length === 0 && matches(found, olds),
          );
          return yield* ownedRead({ fqn, instanceId, output }, found, ours);
        }),

        /**
         * ⛔ THE NAME IS JUDGED BEFORE `isResolved(news)`. Until 2026-09-21 it came after, so a
         *   rename landing with a pending `issuer` (or any other Output) planned `update`, and the
         *   upsert by name wrote a SECOND method: the header's stranding, reached through a green
         *   plan. MEASURED through the engine (rename-families.test.ts).
         */
        diff: Effect.fn(function* ({ instanceId, news, output }) {
          const name = declaredString(news, 'name');
          if (output !== undefined && name !== undefined) {
            const rename = renameProblem(output.name, name);
            if (rename !== undefined) return yield* refuse(name, rename);
          }
          if (output === undefined) return yield* noteResume(instanceId);
          if (!isResolved(news)) return undefined;
          return { action: yield* planTotp(news) } as const;
        }),

        /** ⛔ A rename the diff could not see (the name was an Output), refused before any write. */
        reconcile: Effect.fn(function* ({ fqn, instanceId, news, output }) {
          const rename = output === undefined ? undefined : renameProblem(output.name, news.name);
          if (rename !== undefined) return yield* refuse(news.name, rename);
          return yield* reconcileTotp(news, claimFor({ fqn, instanceId, output }));
        }),

        /** ⛔ Read the header first. Idempotent: an unknown id deletes as success. */
        delete: Effect.fn(function* ({ output }) {
          yield* deleteTotp(output.methodId);
          return undefined;
        }),
      }),
    ),
  );
