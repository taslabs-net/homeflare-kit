/**
 * The observe -> ensure -> sync loop `Ceph.AuthEntity`'s reconcile runs (mon-transport doc,
 * `Ceph.AuthEntity`). Split from auth-entity.ts so the loop itself — the part a fake-runner test
 * actually exercises — is a plain function, the same split ceph-pool.ts and ssh-role.ts use.
 *
 * ⛔ NEVER ADOPTS. A live entity found present while this stack holds no attributes for it is
 *   refused outright, `--adopt` included — the generic `refuseTakeover` (../ownership/adopt.ts)
 *   is deliberately NOT used here, because it honours `--adopt` and this family's own design says
 *   plainly: "Existing auth entities are recorded as observed inventory only — never adopted:
 *   adopting one would mean reading and fingerprinting its key, and a key is only ever handled for
 *   an entity this stack owns."
 * ⛔ THE OBSERVE STEP READS `auth get`'S UNFILTERED STDOUT ON EVERY RECONCILE (decision 65,
 *   2026-09-26, amending the design after LAND finding 5 — no node-side filter narrows it first).
 *   The key that stdout carries is dropped in the same breath: `parseAuthGet` has no `key` field in
 *   its return type at all, so there is no variable here ever holding it past that call. Only `auth
 *   get-or-create`, run once on the create branch, yields a `key` value, and it goes straight to
 *   OpenBao — never assigned to a variable this function returns, logs, or puts in the attributes
 *   it hands back — `attributesOf` takes a fingerprint, never a key.
 * ★ CAPS DRIFT NEVER RE-MINTS THE KEY. `auth caps` changes only what an entity may do; the returned
 *   attributes reuse `output.fingerprint` unchanged.
 * ⛔ A MOVED IDENTITY IS REFUSED HERE TOO, BELT AND SUSPENDERS WITH `planCephAuthEntity`'s
 *   `replace`. `isResolved(news)` in auth-entity.ts's `diff` can defer to the engine's own
 *   `update` fallback while any prop is still an Output (rename.ts's own header documents this
 *   exact Alchemy behaviour for every other family this pattern protects) — a case in which
 *   `planCephAuthEntity` never even runs. Reached with `output` naming a different entity/mount
 *   than `props`, this refuses before any ssh call, the same shape of guard `guardRename`
 *   (openbao/rename-identity.ts) runs first in every `Bao.*` reconcile.
 */
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/http/HttpClient';
import { baoWrite } from '../openbao/bao-http.ts';
import { sha256 } from '../openbao/digest.ts';
import { authCapsArgv, authGetArgv, authGetOrCreateArgv } from './ceph-argv.ts';
import { parseAuthGet, parseAuthGetOrCreate } from './ceph-auth-parse.ts';
import {
  type CephAuthEntityAttributes,
  type CephAuthEntityProps,
  attributesOf,
  capsEqual,
  cephDataPath,
  identityMoved,
} from './ceph-auth-form.ts';
import { type CephTransportOptions, assertFreshQuorum, runCephCommand } from './ceph-transport.ts';

export type CephAuthDeps = Pick<CephTransportOptions, 'dial' | 'log'>;

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const runCeph = (transport: CephTransportOptions, argv: readonly string[]) =>
  Effect.tryPromise({ catch: asError, try: () => runCephCommand(transport, argv) });

const syncQuorum = (transport: CephTransportOptions) =>
  Effect.tryPromise({ catch: asError, try: () => assertFreshQuorum(transport) });

const neverAdopted = (entity: string): Error =>
  new Error(
    `Ceph.AuthEntity ${entity}: already exists on the mon cluster and this stack holds no state ` +
      'for it. This family is never adopted — not even under --adopt — because taking it over ' +
      'would mean fingerprinting a key this stack did not mint. Remove it by hand first, or bring ' +
      'it under management through the coordinator’s own read-only inventory process.',
  );

const movedIdentity = (from: string, to: string): Error =>
  new Error(
    `Ceph.AuthEntity: planned as an update, but its identity moved from ${from} to ${to}. ` +
      `Acting on ${to} now, with ${from}'s attributes, could re-cap an entity this generation ` +
      'never minted. Nothing was sent to any mon. Run the deploy again: once entity/mount fully ' +
      'resolve at plan time this plans as a replace instead.',
  );

export const reconcileCephAuthEntity = (
  props: CephAuthEntityProps,
  output: CephAuthEntityAttributes | undefined,
  deps: CephAuthDeps,
): Effect.Effect<CephAuthEntityAttributes, Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    if (identityMoved(props, output))
      return yield* Effect.fail(movedIdentity(output?.entity ?? '', props.entity));

    const transport: CephTransportOptions = { nodes: props.nodes, ...deps };

    const observed = yield* runCeph(transport, authGetArgv(props.entity)).pipe(
      Effect.map((result) => parseAuthGet(result, props.entity)),
    );

    if (observed.kind === 'absent') {
      // ⛔ THE VAULT WRITE IS CHECKED BEFORE ANYTHING IS MINTED. LAND red team (2026-09-26),
      //   CONFIRMED: minting first and writing second means a write refused by policy (the likely
      //   first-deploy shape — the `data/ceph/*` write grant landing after this stack's first
      //   run) strands a key that only ever existed in memory. The next reconcile's `auth get`
      //   then finds the entity present, `output` is still undefined, and `neverAdopted` refuses
      //   it — permanently, since `auth del` is refused too (D3). A placeholder write proves the
      //   path is writable first; nothing has touched the mon if it fails, so a retry starts
      //   clean. ⚠️ KV-v2 keeps this placeholder as a version in the secret's history (no version
      //   is ever skipped) — harmless, since it never carries anything key-shaped, but visible to
      //   `bao kv get -version=N` until the mount's `max_versions` rolls it off.
      yield* baoWrite('POST', cephDataPath(props.mount, props.entity), {
        data: { pending: true },
      });
      const result = yield* runCeph(transport, authGetOrCreateArgv(props.entity, props.caps));
      const created = parseAuthGetOrCreate(result, props.entity);
      // ⛔ THE ONE PLACE THE KEY CROSSES INTO A BAO CALL — as the HTTP request body's JSON, never
      //   argv, never a temp file. `created.key` is not referenced again after this.
      yield* baoWrite('POST', cephDataPath(props.mount, props.entity), {
        data: { caps: created.caps, key: created.key },
      });
      yield* syncQuorum(transport);
      return attributesOf(props, sha256(created.key), result.node);
    }

    if (output === undefined) return yield* Effect.fail(neverAdopted(props.entity));

    if (capsEqual(observed.caps, props.caps)) return output;

    const result = yield* runCeph(transport, authCapsArgv(props.entity, props.caps));
    yield* syncQuorum(transport);
    return attributesOf(props, output.fingerprint, result.node);
  });
