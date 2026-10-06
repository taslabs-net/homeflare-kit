/**
 * The atomic schema drop against a REAL PostgreSQL. The in-memory fake substitutes a COUNT for the
 * dependency scan and cannot lock, so it cannot see the three defects Codex found in PR 357:
 * an advisory lock that DDL ignores, a closure that missed `pg_collation`, and a TOAST table
 * counted as foreign.
 *
 * ⛔ SKIPPED LOUDLY WITHOUT A SERVER. Set `HF_TEST_POSTGRES=1` and the libpq variables
 *   (`PGHOST`, `PGUSER`, `PGDATABASE`, `PGPASSWORD` or a socket); the kit has no container
 *   harness of its own (measured 2026-10-06: no podman/initdb use in `packages/alchemy` tests).
 *   The connected role needs `CREATE` on the database. Every schema is uniquely named and dropped
 *   on every exit path; nothing else is touched.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { type PsqlRunner, makePsqlExecutor } from './psql-executor.ts';
import { PostgresSchemaCascadeCrossSchemaRefused } from './schema-errors.ts';
import { PostgresSchemaCascadeSequencesRefused } from './schema-sequence-error.ts';
import { dropWithClient } from './schema.ts';

const enabled = process.env['HF_TEST_POSTGRES'] === '1';
if (!enabled) {
  console.warn(
    'SKIPPED schema-drop-real.test.ts: no PostgreSQL. Set HF_TEST_POSTGRES=1 (+ PG* env) to run it.',
  );
}
const suite = enabled ? describe : describe.skip;

const database = process.env['PGDATABASE'] ?? 'postgres';
const username = process.env['PGUSER'] ?? 'postgres';

const spawnPsql = async (argv: readonly string[], stdin: string) => {
  const proc = Bun.spawn([...argv], {
    stdin: new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
};
const runner: PsqlRunner = ({ argv, stdin }) => spawnPsql(argv, stdin);
const pg = makePsqlExecutor(runner, { database, username });
const psql = (sql: string) =>
  spawnPsql(
    ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', username, '-d', database],
    sql,
  );

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const names: string[] = [];
const fresh = (label: string): string => {
  const name = `hf_${label}_${stamp}`;
  names.push(name);
  return name;
};
afterAll(async () => {
  if (!enabled) return;
  for (const name of names) await psql(`DROP SCHEMA IF EXISTS "${name}" CASCADE;`);
});

const present = async (name: string): Promise<boolean> =>
  (await psql(`SELECT count(*) FROM pg_namespace WHERE nspname = '${name}';`)).stdout.trim() ===
  '1';
const props = (name: string) => ({ name, database, cascade: true });

suite('atomic drop on a real PostgreSQL', () => {
  test("an isolated text table cascades: its TOAST relation is the table's", async () => {
    const a = fresh('toast');
    await psql(`CREATE SCHEMA "${a}"; CREATE TABLE "${a}".t (x text);`);
    await Effect.runPromise(dropWithClient(pg, props(a)));
    expect(await present(a)).toBe(false);
  });

  test("a collation used by another schema's table refuses the cascade", async () => {
    const a = fresh('coll_a');
    const b = fresh('coll_b');
    await psql(
      `CREATE SCHEMA "${a}"; CREATE COLLATION "${a}".c (provider = libc, locale = 'C');
       CREATE SCHEMA "${b}"; CREATE TABLE "${b}".t (x text COLLATE "${a}".c);
       INSERT INTO "${b}".t VALUES ('kept');`,
    );
    const error = await Effect.runPromise(Effect.flip(dropWithClient(pg, props(a))));
    expect(error).toBeInstanceOf(PostgresSchemaCascadeCrossSchemaRefused);
    expect(await present(a)).toBe(true);
    expect((await psql(`SELECT x FROM "${b}".t;`)).stdout.trim()).toBe('kept');
  });

  test('a replacement attempted while the drop holds its locks waits and is refused', async () => {
    const a = fresh('race');
    await psql(`CREATE SCHEMA "${a}"; CREATE TABLE "${a}".t (x text);`);
    // Holder: an open transaction reading the table keeps our LOCK TABLE waiting AFTER the
    // schema-object lock is taken — a deterministic pause between lock and drop.
    const holder = spawnPsql(
      ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', username, '-d', database],
      `BEGIN; SELECT 1 FROM "${a}".t; SELECT pg_sleep(4); COMMIT;`,
    );
    await Bun.sleep(700);
    const drop = Effect.runPromise(dropWithClient(pg, props(a)));
    // ⛔ MATCH THE WAIT BY ITS BLOCKER, NOT BY QUERY TEXT: `pg_stat_activity.query` is cut at
    //   `track_activity_query_size` (1024 bytes by default) and the `DO` body's `LOCK TABLE`
    //   sits past it, so a text match never fired and the rival ran after the drop had finished
    //   (measured on PostgreSQL 18, 2026-10-06). A backend blocked by another one is the drop.
    let parked = false;
    for (let i = 0; i < 30 && !parked; i += 1) {
      const waiting = await psql(
        `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND cardinality(pg_catalog.pg_blocking_pids(pid)) > 0 AND query LIKE 'DO %' AND pid <> pg_backend_pid();`,
      );
      parked = waiting.stdout.trim() !== '0';
      if (!parked) await Bun.sleep(100);
    }
    expect(parked).toBe(true);
    // The drop is now parked holding the namespace lock. A competing DROP + CREATE must not get in.
    const rival = await psql(
      `SET lock_timeout = '800ms'; BEGIN; DROP SCHEMA "${a}" CASCADE; CREATE SCHEMA "${a}"; COMMIT;`,
    );
    expect(rival.code).not.toBe(0);
    expect(rival.stderr).toContain('lock timeout');
    await holder;
    await drop;
    expect(await present(a)).toBe(false);
  });

  test('a cascade of a schema holding a sequence refuses and loses nothing', async () => {
    const a = fresh('seq_a');
    const b = fresh('seq_b');
    await psql(
      `CREATE SCHEMA "${a}"; CREATE TABLE "${a}".t (id serial, x text);
       INSERT INTO "${a}".t (x) VALUES ('kept');
       CREATE SCHEMA "${b}"; CREATE VIEW "${b}".v AS SELECT last_value FROM "${a}".t_id_seq;`,
    );
    const error = await Effect.runPromise(Effect.flip(dropWithClient(pg, props(a))));
    expect(error).toBeInstanceOf(PostgresSchemaCascadeSequencesRefused);
    expect(error).toMatchObject({ schema: a, sequences: 1 });
    expect(await present(a)).toBe(true);
    expect((await psql(`SELECT x FROM "${a}".t;`)).stdout.trim()).toBe('kept');
    expect((await psql(`SELECT count(*) FROM "${b}".v;`)).stdout.trim()).toBe('1');
  });

  test('a table added to a foreign extension refuses the cascade (ownership edge leaves)', async () => {
    const a = fresh('ext_a');
    const b = fresh('ext_b');
    await psql(
      `CREATE SCHEMA "${b}"; CREATE EXTENSION hstore SCHEMA "${b}";
       CREATE SCHEMA "${a}"; CREATE TABLE "${a}".t (id int);
       ALTER EXTENSION hstore ADD TABLE "${a}".t;`,
    );
    try {
      const error = await Effect.runPromise(Effect.flip(dropWithClient(pg, props(a))));
      expect(error).toBeInstanceOf(PostgresSchemaCascadeCrossSchemaRefused);
      expect(await present(a)).toBe(true);
      const kept = await psql(`SELECT count(*) FROM pg_extension WHERE extname = 'hstore';`);
      expect(kept.stdout.trim()).toBe('1');
    } finally {
      await psql(`ALTER EXTENSION hstore DROP TABLE "${a}".t; DROP EXTENSION IF EXISTS hstore;`);
    }
  });

  test('a rename-then-recreate while the drop is parked is refused, the replacement survives', async () => {
    const a = fresh('ren');
    const saved = fresh('ren_saved');
    await psql(`CREATE SCHEMA "${a}"; CREATE TABLE "${a}".t (x text);`);
    const holder = spawnPsql(
      ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', username, '-d', database],
      `BEGIN; SELECT 1 FROM "${a}".t; SELECT pg_sleep(4); COMMIT;`,
    );
    await Bun.sleep(700);
    const drop = Effect.runPromise(Effect.flip(dropWithClient(pg, props(a))));
    let parked = false;
    for (let i = 0; i < 30 && !parked; i += 1) {
      const waiting = await psql(
        `SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND cardinality(pg_catalog.pg_blocking_pids(pid)) > 0 AND query LIKE 'DO %' AND pid <> pg_backend_pid();`,
      );
      parked = waiting.stdout.trim() !== '0';
      if (!parked) await Bun.sleep(100);
    }
    expect(parked).toBe(true);
    // RENAME takes no namespace object lock, so it commits while the drop waits.
    const swap = await psql(
      `ALTER SCHEMA "${a}" RENAME TO "${saved}"; CREATE SCHEMA "${a}"; CREATE TABLE "${a}".keep (id int);`,
    );
    expect(swap.code).toBe(0);
    await holder;
    await drop;
    expect((await psql(`SELECT count(*) FROM "${a}".keep;`)).stdout.trim()).toBe('0');
    expect(await present(saved)).toBe(true);
  });
});
