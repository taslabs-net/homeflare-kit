import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { postgresRunnerProviders } from './providers.ts';
import { postgresRunnerConnection, withPg } from './connection.ts';
import { reconcileWithClient } from './database.ts';
import { buildCreateDatabaseSql, isDuplicateDatabaseRace } from './database-sql.ts';
import { buildSetPasswordSql } from './role-sql.ts';
import { scramSha256Verifier } from './role-scram.ts';
import { type PsqlRunner, inlineParams, makePsqlExecutor } from './psql-executor.ts';

const target = { database: 'postgres', username: 'postgres' };
const ok = (stdout: string) => Promise.resolve({ code: 0, stdout, stderr: '' });

describe('psql executor', () => {
  test('inlines string params as literals and refuses non-strings', () => {
    expect(inlineParams('SELECT $1, $2', ["it's", 'b'])).toBe("SELECT 'it''s', 'b'");
    expect(() => inlineParams('SELECT $1', [5])).toThrow('must be a string');
  });

  test('a SELECT is wrapped in json_agg and parsed to rows', async () => {
    const calls: { argv: readonly string[]; stdin: string }[] = [];
    const run: PsqlRunner = (call) => {
      calls.push(call);
      return ok('[{"oid":"16400","name":"x"}]\n');
    };
    const rows = await Effect.runPromise(
      makePsqlExecutor(run, target).unsafe('SELECT 1 FROM pg_database WHERE datname = $1', ['x']),
    );
    expect(rows).toEqual([{ oid: 16400, name: 'x' }]);
    expect(calls[0]?.argv.slice(0, 1)).toEqual(['psql']);
    expect(calls[0]?.stdin).toContain('json_agg');
    expect(calls[0]?.stdin).toContain("datname = 'x'");
  });

  test('a duplicate-database failure stays recognisable as the 42P04 race', async () => {
    const run: PsqlRunner = () =>
      Promise.resolve({
        code: 3,
        stdout: '',
        stderr: 'ERROR:  42P04: database "x" already exists\n',
      });
    const error = await Effect.runPromise(
      Effect.flip(makePsqlExecutor(run, target).unsafe('CREATE DATABASE "x"')),
    );
    expect(isDuplicateDatabaseRace(error)).toBe(true);
  });

  test('a failed password statement carries the SCRAM verifier on stdin, never the plain password', async () => {
    // The red-team finding: the statement text is what the runner inlines into `psql`'s stdin and
    // what a failed `ALTER` echoes back through stderr into the error. Since the fix the text
    // holds only the verifier, so both the stdin side and the error side stay secret-free.
    const placeholder = 'placeholder-password';
    const statement = buildSetPasswordSql('hf_agent', scramSha256Verifier(placeholder));
    let stdin = '';
    const run: PsqlRunner = async (call) => {
      stdin = call.stdin;
      return {
        code: 3,
        stdout: '',
        stderr: `ERROR:  42501: permission denied\nSTATEMENT:  ${statement}\n`,
      };
    };
    const error = await Effect.runPromise(
      Effect.flip(makePsqlExecutor(run, target).unsafe(statement)),
    );
    const rendered = `${error.message}\n${String(error.reason.operation ?? '')}\n${JSON.stringify(error)}`;
    expect(stdin).toContain('SCRAM-SHA-256$');
    expect(stdin).not.toContain(placeholder);
    expect(rendered).not.toContain(placeholder);
    expect(rendered).not.toContain(`PASSWORD '${placeholder.slice(0, 3)}`);
  });

  test('a runner that never reached psql is a ConnectionError', async () => {
    const run: PsqlRunner = () =>
      Promise.resolve({ code: 255, stdout: '', stderr: 'ssh: refused' });
    const error = await Effect.runPromise(
      Effect.flip(makePsqlExecutor(run, target).unsafe('SELECT 1')),
    );
    expect(error.reason._tag).toBe('ConnectionError');
  });
});

describe('runner transport through withPg', () => {
  test('create uses template0 by default and the same adopt path on an existing row', async () => {
    const stdins: string[] = [];
    const row = {
      oid: 1,
      name: 'lite',
      owner: 'litellm',
      encoding: 'UTF8',
      localeProvider: 'libc',
      collate: 'C',
      ctype: 'C',
      allowConnections: true,
      connectionLimit: -1,
      isTemplate: false,
      tablespace: 'pg_default',
    };
    let created = false;
    const run: PsqlRunner = ({ stdin }) => {
      stdins.push(stdin);
      if (stdin.includes('pg_roles')) return ok('[{"present":1}]');
      if (stdin.includes('FROM pg_database')) return ok(created ? JSON.stringify([row]) : '[]');
      if (stdin.startsWith('CREATE DATABASE')) created = true;
      return ok('');
    };
    const layer = postgresRunnerConnection({ run, ...target });
    const props = { name: 'lite', owner: 'litellm' };
    const attrs = await Effect.runPromise(
      withPg((pg, ctx) => reconcileWithClient(pg, props, ctx.template)).pipe(Effect.provide(layer)),
    );
    expect(attrs.name).toBe('lite');
    expect(stdins.find((s) => s.startsWith('CREATE DATABASE'))).toBe(
      `${buildCreateDatabaseSql(props, 'template0')};`,
    );
    expect(stdins.find((s) => s.startsWith('CREATE DATABASE'))).toContain('TEMPLATE "template0"');
    const before = stdins.length;
    await Effect.runPromise(
      withPg((pg, ctx) => reconcileWithClient(pg, props, ctx.template)).pipe(Effect.provide(layer)),
    );
    expect(stdins.slice(before).some((s) => s.startsWith('CREATE DATABASE'))).toBe(false);
  });

  test("postgresRunnerProviders keeps the connection live for the engine's later handler calls", async () => {
    const run: PsqlRunner = () => ok('[]');
    const rows = await Effect.runPromise(
      withPg((pg) => pg.unsafe('SELECT 1')).pipe(
        Effect.provide(postgresRunnerProviders({ run, ...target })),
      ),
    );
    expect(rows).toEqual([]);
  });
});
