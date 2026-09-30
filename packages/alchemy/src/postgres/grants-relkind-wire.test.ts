/**
 * Regression for the critical finding: `TABLES_SQL` selecting `c.relkind` raw made
 * `@effect/sql-pg`'s socket transport hand back the `"char"` column (OID 18) as raw
 * bytes — `PgTypes` has no codec for that OID, so a plain table read as
 * `Uint8Array([114])`, never `'r'` — and `relkindIsPublicRevocable` (`grants-words.ts`)
 * then saw nothing a `REVOKE … ON ALL TABLES IN SCHEMA` reaches: the PUBLIC clear was
 * never planned and `attributesOf` recorded `publicTablesRevoked: true` while PUBLIC
 * still held its words. The fix casts `c.relkind::text` (OID 25, decoded as a string),
 * same shape as the `datlocprovider` CASE in `database-sql.ts`.
 *
 * ⛔ THIS DOES NOT HIT A LIVE SOCKET. It stays faithful to the real defect by pinning
 *   the vendor's own decode for both OIDs (`PgTypes.decode` returns the raw bytes
 *   unchanged for the codec-less OID 18 — measured `PgTypes.ts@4.0.0-rc.115`) and by
 *   driving the production `readGrants` through `makeFakeGrants`, whose tables branch
 *   (`fake-grants-read.ts`) shapes `relkind` per the query TEXT exactly as the wire
 *   would: a string only because the SQL casts `::text`. Reverting the cast makes the
 *   fake answer raw bytes again, and every assertion below fails.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';
import * as PgTypes from '@effect/sql-pg/PgTypes';
import { readGrants } from './grants-read.ts';
import { planRepair } from './grants-plan.ts';
import { attributesOf } from './grants-diff.ts';
import { declaredNames, resolveProps } from './grants-declare.ts';
import { makeFakeGrants } from './fake-grants-sql.ts';

const declared = resolveProps({
  role: 'seat_writer',
  database: 'widgets',
  schema: 'app',
  tables: [{ table: 'widgets', privileges: ['select'] }],
  revokeFromPublic: true,
});

/** PUBLIC holds SELECT on a plain table (`relkind` `'r'`): the exact state the raw-bytes
 * bug misread. */
const makeFake = () =>
  makeFakeGrants({
    schemas: ['app'],
    roles: ['seat_writer'],
    tables: [{ schema: 'app', table: 'widgets', columns: ['id'], relkind: 'r' }],
    acl: [
      {
        object: { schema: 'app', table: 'widgets' },
        grantee: 'PUBLIC',
        grantor: 'postgres',
        words: ['select'],
      },
    ],
  });

describe('measured: the "char" relkind column decodes raw on the socket transport', () => {
  test('PgTypes.decode returns the raw bytes for OID 18 — there is no "char" codec', () => {
    const decoded = PgTypes.decode(new Uint8Array([114]), 18, 1);
    if (!Result.isSuccess(decoded)) throw new Error('fixture: decode failed for OID 18');
    expect(decoded.success instanceof Uint8Array).toBe(true);
    expect(decoded.success).not.toBe('r');
  });

  test('the same byte string decodes as a string through the OID 25 text codec', () => {
    const decoded = PgTypes.decode(new Uint8Array([114]), PgTypes.OID.text, 1);
    if (!Result.isSuccess(decoded)) throw new Error('fixture: decode failed for OID 25');
    expect(decoded.success).toBe('r');
  });
});

describe('readGrants: the ::text cast is what makes relkind a string', () => {
  test('the tables read selects c.relkind::text and answers a string relkind', async () => {
    const fake = makeFake();
    const live = await Effect.runPromise(readGrants(fake, 'app', 'seat_writer'));

    const tablesRead = fake.statements.find((statement) =>
      statement.text.includes('aclexplode(c.relacl)'),
    );
    expect(tablesRead?.text).toContain('c.relkind::text AS relkind');

    expect(live.tables).toHaveLength(1);
    const row = live.tables[0] as (typeof live.tables)[number];
    expect(typeof row.relkind).toBe('string');
    expect(row.relkind).toBe('r');
    expect(row.public).toEqual(['select']);
  });

  test('a PUBLIC grant on a plain table is planned for revoke and recorded as not-yet-revoked', async () => {
    const live = await Effect.runPromise(readGrants(makeFake(), 'app', 'seat_writer'));

    expect(planRepair(declared, live)).toContain(
      'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM PUBLIC',
    );
    expect(attributesOf(live, declaredNames(declared)).publicTablesRevoked).toBe(false);
  });

  test('the raw-bytes row shape the uncast column produces would hide the PUBLIC grant again', async () => {
    const live = await Effect.runPromise(readGrants(makeFake(), 'app', 'seat_writer'));
    // What the pre-fix SQL received on the socket: relkind as the codec-less OID 18 bytes.
    const buggyLive = {
      ...live,
      tables: live.tables.map((table) => ({
        ...table,
        relkind: new Uint8Array([114]) as unknown as string,
      })),
    };

    expect(planRepair(declared, buggyLive)).not.toContain(
      'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM PUBLIC',
    );
    expect(attributesOf(buggyLive, declaredNames(declared)).publicTablesRevoked).toBe(true);
  });
});
