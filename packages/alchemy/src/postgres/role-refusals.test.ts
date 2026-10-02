/**
 * Every plan-time refusal and offline comparison, checked without a client: name-byte precision
 * (the truncation trap `Postgres.Database` refuses), the rename refusal, a full sweep proving
 * `diff` answers `update` and never `replace`, per-field and membership drift semantics,
 * quoting, and the write-only password shape (S25). Zone-free and unparseable `validUntil`
 * live in `role-valid-until.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import { POSTGRES_NAME_MAX_BYTES } from './database-attrs.ts';
import { refuseAtPlan } from './role.ts';
import { diffPostgresRole } from './role-diff.ts';
import { resolvePassword } from './role-secrets.ts';
import { seal } from '../secrets/write-only.ts';
import { PostgresRoleNameRefused, PostgresRoleRenameRefused } from './role-errors.ts';
import type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';
import {
  buildAlterRoleSql,
  buildCreateRoleSql,
  buildDropRoleSql,
  buildSetPasswordSql,
  scalarDrift,
} from './role-sql.ts';
import {
  buildGrantMembershipSql,
  buildRevokeGrantorMembershipSql,
  membershipDrift,
} from './role-membership-sql.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const base: PostgresRoleProps = {
  name: 'seat-observability',
  login: false,
  connectionLimit: 10,
  inherit: true,
};

const output: PostgresRoleAttributes = {
  name: 'seat-observability',
  oid: 20000,
  login: false,
  connectionLimit: 10,
  inherit: true,
  validUntil: null,
  memberOf: [],
  passwordSeal: '',
};

describe('name byte length', () => {
  test('a 63-byte ASCII name passes the plan check', async () => {
    await run(refuseAtPlan({ ...base, name: 'a'.repeat(63) }));
  });

  test('a 64-byte ASCII name is refused with the typed tag naming the measurement', async () => {
    const error = await fails(refuseAtPlan({ ...base, name: 'a'.repeat(64) }));
    expect(error).toBeInstanceOf(PostgresRoleNameRefused);
    expect((error as PostgresRoleNameRefused).byteLength).toBe(64);
    expect((error as PostgresRoleNameRefused).limit).toBe(POSTGRES_NAME_MAX_BYTES);
  });

  test('a 64-byte multibyte name is refused though .length is 32', async () => {
    // U+00E9 ("é") is 2 UTF-8 bytes; 32 of them is 64 bytes — over the 63-byte limit.
    const error = await fails(refuseAtPlan({ ...base, name: 'é'.repeat(32) }));
    expect(error).toBeInstanceOf(PostgresRoleNameRefused);
  });
});

describe('diff', () => {
  test('a rename is refused at plan, before reconcile ever runs', async () => {
    const error = await fails(diffPostgresRole({ ...base, name: 'seat-logs' }, output));
    expect(error).toBeInstanceOf(PostgresRoleRenameRefused);
  });

  test('an unchanged declaration answers noop, and no output answers undefined (nothing to diff)', async () => {
    expect(await run(diffPostgresRole(base, output))).toEqual({ action: 'noop' });
    expect(await run(diffPostgresRole(base, undefined))).toBeUndefined();
  });

  test('a change in any single prop answers update, and NEVER replace \u2014 swept across every prop', async () => {
    const variants: ReadonlyArray<
      readonly [Partial<PostgresRoleProps>, Partial<PostgresRoleAttributes>]
    > = [
      [{ login: true }, {}],
      [{ inherit: false }, {}],
      [{ connectionLimit: 5 }, {}],
      [{ validUntil: '2027-01-01T00:00:00Z' }, {}],
      [{ memberOf: ['hf_agent'] }, {}],
      [{ memberOf: [] }, { memberOf: ['hf_agent'] }],
      [{ memberOf: ['hf_agent', 'seat-owners'] }, { memberOf: ['hf_agent'] }],
    ];
    for (const [variant, live] of variants) {
      const result = await run(diffPostgresRole({ ...base, ...variant }, { ...output, ...live }));
      expect(result?.action, `variant ${JSON.stringify(variant)}`).toBe('update');
      expect(result).not.toEqual({ action: 'replace' });
    }
  });

  test('a rotated password answers update even with no other drift; a matching or unreadable one does not', async () => {
    const declared = { ...base, password: { fromEnv: 'PG_SEAT_ROLE_PASSWORD' } as const };
    const stale = seal({ password: 'old' }, 'fixed-salt');
    const matched = seal({ password: 'current' }, 'fixed-salt');
    const held = { PG_SEAT_ROLE_PASSWORD: 'current' };
    // A value the seal does not match — rotated, or an adopted role's empty seal — answers update.
    expect(await run(diffPostgresRole(declared, { ...output, passwordSeal: stale }, held))).toEqual(
      { action: 'update' },
    );
    expect(await run(diffPostgresRole(declared, output, held))).toEqual({ action: 'update' });
    // Still matching: noop. The variable unset here: never stale — a plan that cannot read the
    // secret never churns it.
    expect(
      await run(diffPostgresRole(declared, { ...output, passwordSeal: matched }, held)),
    ).toEqual({ action: 'noop' });
    expect(await run(diffPostgresRole(declared, { ...output, passwordSeal: stale }, {}))).toEqual({
      action: 'noop',
    });
  });
});

describe('scalarDrift', () => {
  test('lists one change per drifted field, in the family\u2019s compared order', () => {
    expect(
      scalarDrift(
        {
          ...base,
          login: true,
          inherit: false,
          connectionLimit: 5,
          validUntil: '2027-01-01T00:00:00Z',
        },
        { ...output, login: false, inherit: true, connectionLimit: 10 },
      ),
    ).toEqual([
      { prop: 'login', value: true },
      { prop: 'inherit', value: false },
      { prop: 'connectionLimit', value: 5 },
      { prop: 'validUntil', value: '2027-01-01T00:00:00Z' },
    ]);
  });

  test('is empty when the live row matches, including the milliseconds case', () => {
    expect(scalarDrift(base, output)).toEqual([]);
    expect(
      scalarDrift(
        { ...base, validUntil: '2027-01-01T00:00:00Z' },
        {
          ...output,
          validUntil: '2027-01-01T00:00:00.000Z',
        },
      ),
    ).toEqual([]);
  });
});

describe('membershipDrift', () => {
  test('undefined asserts nothing; duplicates collapse; grants and revokes are sorted set differences', () => {
    expect(membershipDrift(undefined, ['hf_agent'])).toEqual({ grants: [], revokes: [] });
    expect(membershipDrift(['hf_agent', 'hf_agent', 'seat-b'], [])).toEqual({
      grants: ['hf_agent', 'seat-b'],
      revokes: [],
    });
    expect(membershipDrift(['hf_agent'], ['hf_agent', 'seat-b', 'seat-a'])).toEqual({
      grants: [],
      revokes: ['seat-a', 'seat-b'],
    });
  });
});

describe('quoting', () => {
  test('a hostile role name is doubled in every statement that quotes it', () => {
    expect(buildCreateRoleSql({ ...base, name: 'a"b' })).toBe(
      'CREATE ROLE "a""b" WITH NOLOGIN INHERIT CONNECTION LIMIT 10',
    );
    expect(buildAlterRoleSql('a"b', { prop: 'connectionLimit', value: 3 })).toBe(
      'ALTER ROLE "a""b" WITH CONNECTION LIMIT 3',
    );
    expect(buildGrantMembershipSql('m"1', 'p"2')).toBe('GRANT "p""2" TO "m""1" WITH SET FALSE');
    expect(buildRevokeGrantorMembershipSql('m"1', 'p"2', 'g"3')).toBe(
      'REVOKE "p""2" FROM "m""1" GRANTED BY "g""3"',
    );
    expect(buildDropRoleSql('a"b')).toBe('DROP ROLE IF EXISTS "a""b"');
  });

  test('the value buildSetPasswordSql carries is single-quote escaped exactly once', () => {
    // In production that value is a SCRAM verifier (`role-scram.ts`), which the base64 alphabet
    // keeps free of `'`; the quoting property still holds for any string handed to the builder.
    expect(buildSetPasswordSql('seat-observability', "O'Brien; DROP")).toBe(
      "ALTER ROLE \"seat-observability\" WITH PASSWORD E'O''Brien; DROP'",
    );
  });
});

describe('write-only password shape (S25)', () => {
  const props = { ...base, password: { fromEnv: 'PG_SEAT_ROLE_PASSWORD' } };

  test('resolvePassword holds the value as Redacted, which never prints or serialises it', () => {
    const { variable, value } = resolvePassword(props, { PG_SEAT_ROLE_PASSWORD: 's3cret-value' });
    expect(variable).toBe('PG_SEAT_ROLE_PASSWORD');
    expect(String(value)).toBe('<redacted>');
    expect(JSON.stringify({ value })).not.toContain('s3cret-value');
    expect(Redacted.isRedacted(value)).toBe(true);
    if (Redacted.isRedacted(value)) {
      expect(Redacted.value(value)).toBe('s3cret-value');
    }
  });

  test('resolvePassword answers no value when the variable is unset or empty', () => {
    expect(resolvePassword(props, {}).value).toBeUndefined();
    expect(resolvePassword(props, { PG_SEAT_ROLE_PASSWORD: '' }).value).toBeUndefined();
    expect(resolvePassword(base, { PG_SEAT_ROLE_PASSWORD: 's3cret-value' })).toEqual({
      variable: undefined,
      value: undefined,
    });
  });
});

describe('removal policy', () => {
  test('defaultRemovalPolicy is retain (checked in source, declared alongside PostgresRole)', () => {
    const source = readFileSync(new URL('./role.ts', import.meta.url), 'utf8');
    expect(source).toContain("defaultRemovalPolicy: 'retain'");
  });
});
