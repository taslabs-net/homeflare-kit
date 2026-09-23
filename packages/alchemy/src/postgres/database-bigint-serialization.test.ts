/**
 * Regression for the critical finding: `SELECT_DATABASE_SQL` casting `oid`/`datconnlimit` to
 * `::int8` makes `@effect/sql-pg`'s binary-protocol codec decode them as JS `bigint`, and
 * alchemy's `encodeState` has no `bigint` branch — so `JSON.stringify`ing the persisted state
 * throws on every successful `reconcile`, and a matching declared `connectionLimit` reads as
 * permanent drift (`bigint !== number`).
 *
 * ⛔ THIS DOES NOT HIT A LIVE SOCKET. It stays faithful to the real defect by driving the exact
 *   query TEXT `selectDatabase` sends (`fake-sql.ts`'s recorder does not decode types at all, so
 *   it cannot see this bug) through `@effect/sql-pg/PgTypes`'s own public `encode`/`decode`
 *   (the same codec table the real driver looks up by OID — measured `PgTypes.ts@4.0.0-rc.115`)
 *   and through alchemy's own `encodeState` (`alchemy/State/StateEncoding`, what `LocalState.js`
 *   calls before every `JSON.stringify`). If a column is cast to `::int8` in the production SQL,
 *   this fake decodes it exactly as the real wire would: a genuine `bigint`, round-tripped
 *   through the vendor's own codec, not a hand-simulated one.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import * as PgTypes from '@effect/sql-pg/PgTypes';
import type { SqlError } from 'effect/unstable/sql/SqlError';
import { encodeState } from 'alchemy/State/StateEncoding';
import { reconcileWithClient } from './database.ts';
import { PostgresDatabaseDrift } from './errors.ts';
import type { PostgresDatabaseProps } from './database-attrs.ts';
import type { PgExecutor } from './database-sql.ts';

/** Round-trip `value` through the real `@effect/sql-pg` codec for `oid` — encode, then decode
 * the resulting wire bytes back — so the JS type this returns is whatever the real driver would
 * hand back for that OID, not an assumption about it. */
const wireRoundtrip = (value: number, oid: number): number | bigint => {
  const encoded = PgTypes.encode(oid === PgTypes.OID.int8 ? BigInt(value) : value, oid);
  if (!Result.isSuccess(encoded)) throw new Error(`fixture: encode failed for OID ${String(oid)}`);
  const decoded = PgTypes.decode(encoded.success, oid, 1);
  if (!Result.isSuccess(decoded)) throw new Error(`fixture: decode failed for OID ${String(oid)}`);
  return decoded.success as number | bigint;
};

const baseRow = {
  name: 'widgets',
  owner: 'tim',
  encoding: 'UTF8',
  localeProvider: 'libc',
  collate: 'C',
  ctype: 'C',
  allowConnections: true,
  isTemplate: false,
  tablespace: 'pg_default',
};

/** A `pg_database` row decoded exactly as the production `SELECT_DATABASE_SQL` TEXT dictates:
 * `oid`/`connectionLimit` come back as `bigint` only when that text casts them to `::int8` —
 * the same condition that flips the real driver's codec lookup. */
const wireAccurateRow = (text: string, oid: number, connectionLimit: number) => ({
  ...baseRow,
  oid: wireRoundtrip(oid, text.includes('d.oid::int8 AS oid') ? PgTypes.OID.int8 : PgTypes.OID.oid),
  connectionLimit: wireRoundtrip(
    connectionLimit,
    text.includes('d.datconnlimit::int8 AS "connectionLimit"')
      ? PgTypes.OID.int8
      : PgTypes.OID.int4,
  ),
});

/** A `PgExecutor` that answers `SELECT_DATABASE_SQL` with a wire-accurate row (see above) and
 * every other statement the way `fake-sql.ts`'s own fake does. `seed`, when given, is the row
 * already "on the cluster" — so `reconcileWithClient` takes the already-present/drift-check
 * branch instead of create. With no seed, a `CREATE DATABASE` statement makes one up (oid
 * 30000, the default `connectionLimit` of -1) so the mandatory post-create re-read has a row to
 * decode — mirroring `fake-sql.ts`'s own greenfield bookkeeping. */
const wireAccuratePg = (seed?: {
  readonly oid: number;
  readonly connectionLimit: number;
}): PgExecutor => {
  let created: { readonly oid: number; readonly connectionLimit: number } | undefined = seed;
  return {
    unsafe: <A extends object>(text: string, params: ReadonlyArray<unknown> = []) =>
      Effect.suspend(() => {
        if (text.startsWith('SELECT 1 AS present FROM pg_roles')) {
          return Effect.succeed([{ present: 1 }] as unknown as ReadonlyArray<A>);
        }
        if (text.includes('FROM pg_database')) {
          if (created === undefined) return Effect.succeed([] as unknown as ReadonlyArray<A>);
          const row = wireAccurateRow(text, created.oid, created.connectionLimit);
          return Effect.succeed([row] as unknown as ReadonlyArray<A>);
        }
        if (text.startsWith('CREATE DATABASE')) {
          created = { oid: 30000, connectionLimit: -1 };
          return Effect.succeed([] as unknown as ReadonlyArray<A>);
        }
        throw new Error(`wireAccuratePg: unrecognised statement: ${text}`);
      }) as Effect.Effect<ReadonlyArray<A>, SqlError>,
  };
};

const baseProps: PostgresDatabaseProps = { name: 'widgets', owner: 'tim' };

describe('measured: @effect/sql-pg int8 vs native-width codecs (PgTypes.ts@4.0.0-rc.115)', () => {
  test('OID.int8 decodes to a JS bigint', () => {
    expect(typeof wireRoundtrip(20000, PgTypes.OID.int8)).toBe('bigint');
  });

  test('OID.oid and OID.int4 — the columns’ real pg_database.h widths — decode to a JS number', () => {
    expect(typeof wireRoundtrip(20000, PgTypes.OID.oid)).toBe('number');
    expect(typeof wireRoundtrip(-1, PgTypes.OID.int4)).toBe('number');
  });
});

describe('reconcileWithClient: state must survive alchemy’s real encodeState + JSON.stringify', () => {
  test('greenfield create-and-reread never returns a value the state encoder cannot serialize', async () => {
    const pg = wireAccuratePg();
    const attrs = await Effect.runPromise(reconcileWithClient(pg, baseProps));

    expect(typeof attrs.oid).toBe('number');
    expect(typeof attrs.connectionLimit).toBe('number');

    let json: string | undefined;
    expect(() => {
      json = JSON.stringify(encodeState(attrs), null, 2);
    }).not.toThrow();
    expect(JSON.parse(json as string)).toMatchObject({ oid: attrs.oid, connectionLimit: -1 });
  });

  test('a declared connectionLimit that matches the live value is a no-op, not a false-positive drift', async () => {
    const pg = wireAccuratePg({ oid: 30000, connectionLimit: 5 });
    const attrs = await Effect.runPromise(
      reconcileWithClient(pg, { ...baseProps, connectionLimit: 5 }),
    );
    expect(attrs.connectionLimit).toBe(5);
  });

  test('PostgresDatabaseDrift.message never throws building itself, even when a mismatch is real', async () => {
    const pg = wireAccuratePg({ oid: 30000, connectionLimit: 5 });
    const error = await Effect.runPromise(
      Effect.flip(reconcileWithClient(pg, { ...baseProps, connectionLimit: 10 })),
    );
    expect(error).toBeInstanceOf(PostgresDatabaseDrift);
    expect(() => (error as PostgresDatabaseDrift).message).not.toThrow();
  });
});
