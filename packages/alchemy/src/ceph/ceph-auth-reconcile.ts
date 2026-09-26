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
 * ⛔ THE KEY IS READ EXACTLY ONCE, ON THE CREATE PATH, AND WRITTEN STRAIGHT TO OPENBAO. It is never
 *   assigned to a variable this function returns, logs, or puts in the attributes it hands back —
 *   `attributesOf` takes a fingerprint, never a key.
 * ★ CAPS DRIFT NEVER RE-MINTS THE KEY. `auth caps` changes only what an entity may do; the returned
 *   attributes reuse `output.fingerprint` unchanged.
 */
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
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

export const reconcileCephAuthEntity = (
  props: CephAuthEntityProps,
  output: CephAuthEntityAttributes | undefined,
  deps: CephAuthDeps,
): Effect.Effect<CephAuthEntityAttributes, Error, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const transport: CephTransportOptions = { nodes: props.nodes, ...deps };

    const observed = yield* runCeph(transport, authGetArgv(props.entity)).pipe(
      Effect.map((result) => parseAuthGet(result, props.entity)),
    );

    if (observed.kind === 'absent') {
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
