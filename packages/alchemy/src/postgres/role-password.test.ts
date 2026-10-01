/**
 * The write-only password lifecycle (S25) against `fake-sql.ts`'s recording fake: the
 * declaration is the NAME of an environment variable, the value exists only in memory and on
 * the wire of the one dedicated `ALTER ROLE … PASSWORD` statement, and what state remembers is
 * a scrypt seal. Create, adopt, rotate and the never-guessed refusals.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import type { PgExecutor } from './database-sql.ts';
import { seal, sealMatches } from '../secrets/write-only.ts';
import { makeFakeSql } from './fake-sql.ts';
import { PostgresRoleCreateVanished, PostgresRolePasswordEnvUnsetError } from './role-errors.ts';
import type { PostgresRoleAttributes, PostgresRoleProps } from './role-attrs.ts';
import { reconcileWithClient } from './role.ts';

const run = <A, E>(eff: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(eff);
const fails = <A, E>(eff: Effect.Effect<A, E>): Promise<E> => Effect.runPromise(Effect.flip(eff));

const baseProps: PostgresRoleProps = {
  name: 'seat-observability',
  login: false,
  connectionLimit: 10,
  inherit: true,
};

const liveRole = (over: Partial<PostgresRoleAttributes> = {}): PostgresRoleAttributes => ({
  name: 'seat-observability',
  oid: 20000,
  login: false,
  connectionLimit: 10,
  inherit: true,
  validUntil: null,
  memberOf: [],
  passwordSeal: '',
  ...over,
});

const startingWith = (fake: ReturnType<typeof makeFakeSql>, prefix: string) =>
  fake.statements.filter((s) => s.text.startsWith(prefix));

const withPassword = {
  ...baseProps,
  password: { fromEnv: 'PG_SEAT_ROLE_PASSWORD' },
};

describe('password: create', () => {
  test('travels in a dedicated ALTER, never in the CREATE, and only its seal lands in state', async () => {
    const fake = makeFakeSql();
    const attrs = await run(
      reconcileWithClient(fake, withPassword, { PG_SEAT_ROLE_PASSWORD: 's3cret-value' }),
    );
    expect(startingWith(fake, 'CREATE ROLE')[0]?.text.includes('PASSWORD')).toBe(false);
    // The statement carries the SCRAM-SHA-256 verifier, never the plain value: this is the text
    // that reaches the span attribute `db.query.text` on the socket transport and the inlined
    // stdin on the runner transport, so both are covered by one assertion over the shared text.
    const sent = startingWith(fake, 'ALTER ROLE').map((s) => s.text);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^ALTER ROLE "seat-observability" WITH PASSWORD E'SCRAM-SHA-256\$/);
    expect(JSON.stringify(fake.statements)).not.toContain('s3cret-value');
    expect(JSON.stringify(attrs)).not.toContain('s3cret-value');
    // The seal stays a seal of the plain value — only the wire form changed.
    expect(sealMatches(attrs.passwordSeal, { password: 's3cret-value' })).toBe(true);
  });

  test('a missing environment value refuses before any statement — never a guess', async () => {
    const fake = makeFakeSql();
    const error = await fails(reconcileWithClient(fake, withPassword, {}));
    expect(error).toBeInstanceOf(PostgresRolePasswordEnvUnsetError);
    expect((error as PostgresRolePasswordEnvUnsetError).variable).toBe('PG_SEAT_ROLE_PASSWORD');
    // The reconcile reads first (one SELECT); the refusal lands before any write statement.
    expect(startingWith(fake, 'CREATE').length).toBe(0);
    expect(startingWith(fake, 'ALTER').length).toBe(0);
  });
});

describe('password: live role', () => {
  test('a rotated environment value rewrites the password under a fresh seal', async () => {
    const oldSeal = seal({ password: 'old' }, 'fixed-salt');
    const fake = makeFakeSql({ roleRows: [liveRole()] });
    const attrs = await run(
      reconcileWithClient(fake, withPassword, { PG_SEAT_ROLE_PASSWORD: 'new' }, oldSeal),
    );
    const sent = startingWith(fake, 'ALTER ROLE').map((s) => s.text);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^ALTER ROLE "seat-observability" WITH PASSWORD E'SCRAM-SHA-256\$/);
    expect(JSON.stringify(fake.statements)).not.toContain('new');
    expect(sealMatches(attrs.passwordSeal, { password: 'new' })).toBe(true);
    expect(sealMatches(attrs.passwordSeal, { password: 'old' })).toBe(false);
  });

  test('an unchanged environment value sends no password statement and keeps the seal bit-identical', async () => {
    const oldSeal = seal({ password: 'old' }, 'fixed-salt');
    const fake = makeFakeSql({ roleRows: [liveRole()] });
    const attrs = await run(
      reconcileWithClient(fake, withPassword, { PG_SEAT_ROLE_PASSWORD: 'old' }, oldSeal),
    );
    expect(fake.statements.some((s) => s.text.startsWith('ALTER'))).toBe(false);
    expect(attrs.passwordSeal).toBe(oldSeal);
  });

  test('an adopted role (empty seal) gets the password written on the first reconcile that holds it', async () => {
    const fake = makeFakeSql({ roleRows: [liveRole()] });
    const attrs = await run(
      reconcileWithClient(fake, withPassword, { PG_SEAT_ROLE_PASSWORD: 'first' }),
    );
    expect(startingWith(fake, 'ALTER ROLE').length).toBe(1);
    expect(sealMatches(attrs.passwordSeal, { password: 'first' })).toBe(true);
  });

  test('an environment that went empty on a live role never churns the stored password', async () => {
    const oldSeal = seal({ password: 'old' }, 'fixed-salt');
    const fake = makeFakeSql({ roleRows: [liveRole()] });
    const attrs = await run(
      reconcileWithClient(fake, withPassword, { PG_SEAT_ROLE_PASSWORD: '' }, oldSeal),
    );
    expect(fake.statements.some((s) => s.text.startsWith('ALTER'))).toBe(false);
    expect(attrs.passwordSeal).toBe(oldSeal);
  });

  test('a declared password whose seal is still empty refuses an unset variable on the update path', async () => {
    // CREATE ROLE committed, then ALTER ROLE … PASSWORD failed or the process died before state
    // was saved. The next run sees the role and an empty seal. Reporting success would leave a
    // LOGIN role this stack has never sealed.
    const fake = makeFakeSql({ roleRows: [liveRole({ login: true })] });
    const error = await fails(
      reconcileWithClient(fake, { ...withPassword, login: true }, { PG_SEAT_ROLE_PASSWORD: '' }),
    );
    expect(error).toBeInstanceOf(PostgresRolePasswordEnvUnsetError);
    expect(fake.statements.some((s) => s.text.startsWith('ALTER'))).toBe(false);
  });
});

describe('password: no new write statements on the no-op path', () => {
  test('a create with no password declared never mentions PASSWORD at all', async () => {
    const fake = makeFakeSql();
    await run(reconcileWithClient(fake, baseProps));
    expect(fake.statements.some((s) => s.text.includes('PASSWORD'))).toBe(false);
  });

  test('a vanished create on a password-carrying reconcile fails typed, with the password statement issued first', async () => {
    // The blank executor answers every read with `[]` (absent), so the reconcile takes the
    // create path: CREATE, then the dedicated password ALTER, then a re-read that finds nothing.
    // The typed `PostgresRoleCreateVanished` surfaces that — the value stayed on the wire, and
    // the failure is never a secret leak.
    const unsafe = <A extends object>(_sql?: string) => Effect.succeed([] as ReadonlyArray<A>);
    const blankPg: PgExecutor = {
      unsafe,
      transaction: (statements) =>
        Effect.gen(function* () {
          for (const sql of statements) yield* unsafe(sql).pipe(Effect.asVoid);
        }),
    };
    const error = await fails(
      reconcileWithClient(blankPg, withPassword, { PG_SEAT_ROLE_PASSWORD: 'v' }),
    );
    expect(error).toBeInstanceOf(PostgresRoleCreateVanished);
  });
});
