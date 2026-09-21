/**
 * The read / plan / reconcile loop the newer role families share (Bao.JwtRole, Bao.KubernetesRole,
 * Bao.JwtAuthConfig): one path, one body, one comparison. Each family supplies its own form; this
 * owns the order of operations, which is where the estate's providers have gone wrong before.
 *
 * ★ THE ORDER, AND WHY EACH STEP IS THERE:
 *   1. Refuse a declaration the family knows is wrong, before any call (`problems`).
 *   2. Read live. Write only when it differs — an identical write is still an audit line.
 *   3. Before writing over a live object, refuse if the write would silently destroy something
 *      this resource does not model (`wouldErase`, the ssh-role.ts pattern).
 *   4. Re-read, and refuse unless live now MATCHES. A 2xx is not proof: the server can accept a
 *      field and store something else (pki-role.ts has the history).
 * ⛔ A DECLARATION reconcile WOULD REFUSE NEVER PLANS `noop` — `planRole` routes it to `update`,
 *   so the refusal is seen at the next deploy instead of hiding behind a clean plan.
 */
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type { Claim, Owner } from '../ownership/adopt.ts';
import { ownedRead } from '../ownership/probe.ts';
import { baoRead, baoWrite } from './bao-http.ts';
import type { BaoError } from './bao-status.ts';

export interface RoleSpec<A> {
  /** `Bao.JwtRole` etc., for messages. */
  readonly family: string;
  /** The API path, e.g. `auth/jwt/role/humans`. */
  readonly path: string;
  readonly problems: readonly string[];
  readonly attributesOf: (live: Record<string, unknown>) => A;
  readonly matches: (attributes: A) => boolean;
  readonly body: Readonly<Record<string, unknown>>;
  /** Live fields a write would reset that the declaration does not model. */
  readonly wouldErase?: (live: Record<string, unknown>) => readonly string[];
}

type Found<A> = { readonly attributes: A; readonly live: Record<string, unknown> };

export const readRoleAt = <A>(
  spec: RoleSpec<A>,
): Effect.Effect<Found<A> | undefined, BaoError, HttpClient.HttpClient> =>
  Effect.map(baoRead(spec.path), (live) =>
    live === undefined ? undefined : { attributes: spec.attributesOf(live), live },
  );

/**
 * `read`: the live attributes — `Unowned` with no state unless our own interrupted create wrote
 * them, which is `planRole`'s `noop` against that create's props (ownership/probe.ts).
 */
export const readOwnedRole = <A extends object>(
  ask: Owner,
  spec: RoleSpec<A>,
): Effect.Effect<A | undefined, BaoError, HttpClient.HttpClient> =>
  Effect.flatMap(readRoleAt(spec), (found) => {
    const ours = Effect.sync(
      () => found !== undefined && spec.problems.length === 0 && spec.matches(found.attributes),
    );
    return ownedRead(ask, found?.attributes, ours);
  });

/** `update` or `noop` — the part of a diff after the identity checks. */
export const planRole = <A>(
  spec: RoleSpec<A>,
): Effect.Effect<'noop' | 'update', BaoError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    if (spec.problems.length > 0) return 'update';
    const found = yield* readRoleAt(spec);
    return found !== undefined && spec.matches(found.attributes) ? 'noop' : 'update';
  });

const refuse = (spec: { readonly family: string; readonly path: string }, message: string) =>
  Effect.die(new Error(`${spec.family} ${spec.path}: ${message}`));

/**
 * ⛔ `claim` — every provider passes it — refuses, before any write, a create that finds a live
 *   object this stack holds no state for (ownership/adopt.ts).
 */
export const reconcileRole = <A>(
  spec: RoleSpec<A>,
  claim?: Claim,
): Effect.Effect<A, BaoError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    if (spec.problems.length > 0) return yield* refuse(spec, spec.problems.join('; '));
    const found = yield* readRoleAt(spec);
    if (found !== undefined && claim !== undefined) yield* claim(`${spec.family} ${spec.path}`);
    if (found === undefined || !spec.matches(found.attributes)) {
      const lost = found === undefined ? [] : (spec.wouldErase?.(found.live) ?? []);
      if (lost.length > 0) {
        return yield* refuse(
          spec,
          `live carries ${lost.join(', ')}, which this resource does not declare and the write ` +
            'would reset. Fold it into the declaration, or clear it by hand first.',
        );
      }
      // ★ PUT, as `bao write` sends (api/logical.go); http/logical.go maps PUT and POST alike.
      yield* baoWrite('PUT', spec.path, spec.body);
    }
    const after = yield* readRoleAt(spec);
    if (after === undefined) return yield* refuse(spec, 'write reported success but it is absent.');
    if (!spec.matches(after.attributes)) {
      return yield* refuse(
        spec,
        'wrote cleanly but read back different — OpenBao stored something other than what was ' +
          'declared. Read it by hand before retrying.',
      );
    }
    return after.attributes;
  });
