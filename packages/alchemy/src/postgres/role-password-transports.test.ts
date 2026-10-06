/** Capture the actual Effect SQL spans and psql stdin, not just the builder's output. */
import { expect, test } from 'bun:test';
import * as PgClient from '@effect/sql-pg/PgClient';
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';
import * as Tracer from 'effect/Tracer';
import * as Statement from 'effect/unstable/sql/Statement';
import type { Connection } from 'effect/unstable/sql/SqlConnection';
import type { PgExecutor } from './database-sql.ts';
import { makeFakeSql } from './fake-sql.ts';
import { type PsqlRunner, makePsqlExecutor } from './psql-executor.ts';
import { stripPin } from './search-path.ts';
import { reconcileWithClient } from './role.ts';

const props = {
  name: 'transport-seat',
  login: true,
  inherit: true,
  connectionLimit: -1,
  password: { fromEnv: 'TEST_PASSWORD' },
};
// Synthetic test input, deliberately recognizable if it escapes into captured telemetry.
const password = 'kit336-plaintext-canary:must-never-reach-transport!';
const env = { TEST_PASSWORD: password };
const live = { ...props, oid: 42, validUntil: null, memberOf: [], passwordSeal: '' };

test('SQL tracer captures only a verifier on create, rotate and failed ALTER', async () => {
  for (const exists of [false, true]) {
    for (const fail of [false, true]) {
      const fake = makeFakeSql({
        roleRows: exists ? [live] : [],
        ...(fail ? { failNext: 'ALTER ROLE' } : {}),
      });
      const spans: Tracer.Span[] = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = Tracer.nativeTracer.span(options);
          spans.push(span);
          return span;
        },
      });
      const execute: Connection['execute'] = (sql, params) => fake.unsafe(sql, params);
      const connection: Connection = {
        execute,
        executeUnprepared: execute,
        executeRaw: (sql, params) => fake.unsafe(sql, params),
        executeValues: () => Effect.succeed([]),
        executeValuesUnprepared: () => Effect.succeed([]),
        executeStream: () => Stream.empty,
      };
      // Use the installed SQL Statement and PG compiler: db.query.text is set by Effect,
      // while only the connection beneath it is fake. A hand-written span would prove nothing.
      const sql = Statement.make(
        Effect.succeed(connection),
        PgClient.makeCompiler(),
        [],
        undefined,
      );
      const pg: PgExecutor = {
        unsafe: (text, params) => sql.unsafe(text, params),
        transaction: (texts) =>
          Effect.gen(function* () {
            for (const text of texts) yield* sql.unsafe(text);
          }),
      };
      const result = await Effect.runPromise(
        Effect.exit(reconcileWithClient(pg, props, env, exists ? 'stale-seal' : '')).pipe(
          Effect.provideService(Tracer.Tracer, tracer),
        ),
      );
      expect(result._tag).toBe(fail ? 'Failure' : 'Success');
      const attributes = spans.map((span) => Object.fromEntries(span.attributes));
      const passwordQueries = attributes
        .map((a) => a['db.query.text'])
        .filter((text): text is string => typeof text === 'string' && text.includes('PASSWORD'));
      expect(passwordQueries).toHaveLength(1);
      expect(passwordQueries[0]).toContain("PASSWORD E'SCRAM-SHA-256$");
      expect(JSON.stringify({ attributes, result })).not.toContain(password);
    }
  }
});

test('psql runner receives only a verifier; echoed failure and state hold no plain value', async () => {
  for (const exists of [false, true]) {
    for (const fail of [false, true]) {
      const calls: Parameters<PsqlRunner>[0][] = [];
      let created = exists;
      const run: PsqlRunner = (raw) => {
        const call = { ...raw, stdin: stripPin(raw.stdin) };
        calls.push(call);
        if (call.stdin.includes('PASSWORD') && fail) {
          return Promise.resolve({
            code: 3,
            stdout: '',
            stderr: `ERROR:  42501: refused\nSTATEMENT: ${call.stdin}`,
          });
        }
        if (call.stdin.startsWith('BEGIN')) created = true;
        return Promise.resolve({
          code: 0,
          stderr: '',
          stdout: call.stdin.includes('FROM pg_catalog.pg_roles r')
            ? JSON.stringify(created ? [live] : [])
            : '[]',
        });
      };
      const result = await Effect.runPromise(
        Effect.exit(
          reconcileWithClient(
            makePsqlExecutor(run, { database: 'postgres', username: 'postgres' }),
            props,
            env,
            exists ? 'stale-seal' : '',
          ),
        ),
      );
      expect(result._tag).toBe(fail ? 'Failure' : 'Success');
      const writes = calls.filter((call) => call.stdin.includes('PASSWORD'));
      expect(writes).toHaveLength(1);
      expect(writes[0]?.stdin).toContain("PASSWORD E'SCRAM-SHA-256$");
      expect(JSON.stringify({ calls, result })).not.toContain(password);
      expect(JSON.stringify(result)).not.toContain('SCRAM-SHA-256$');
    }
  }
});
