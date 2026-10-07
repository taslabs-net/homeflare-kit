/**
 * The `search_path` pin (`search-path.ts`): every session this family opens starts with
 * `SET search_path = pg_catalog, pg_temp`, on both transports, and the SQL builders only name
 * catalogs as `pg_catalog.*`. The Opus read of PR 334 (2026-10-02) found that a role allowed to
 * create objects in a schema on the path could forge `pg_namespace` and fake the delete proof.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { currentDatabase } from './schema-sql.ts';
import { makePsqlExecutor } from './psql-executor.ts';
import { PIN_SCRIPT_PREFIX, PIN_SEARCH_PATH_SQL } from './search-path.ts';

describe('runner transport', () => {
  const target = { database: 'postgres', username: 'postgres' };
  const record = () => {
    const stdins: string[] = [];
    const run = ({ stdin }: { stdin: string }) => {
      stdins.push(stdin);
      return Promise.resolve({ code: 0, stdout: '[]', stderr: '' });
    };
    return { stdins, run };
  };

  test('a read starts with the pin, in the same psql session as the statement', async () => {
    const { stdins, run } = record();
    await Effect.runPromise(currentDatabase(makePsqlExecutor(run, target)));
    expect(stdins).toHaveLength(1);
    expect(stdins[0]?.startsWith('SET search_path = pg_catalog, pg_temp;\n')).toBe(true);
    expect(stdins[0]?.startsWith(PIN_SCRIPT_PREFIX)).toBe(true);
  });

  test('a write and a transaction start with the pin too', async () => {
    const { stdins, run } = record();
    const pg = makePsqlExecutor(run, target);
    await Effect.runPromise(pg.unsafe('COMMENT ON SCHEMA "a" IS E\'b\''));
    await Effect.runPromise(pg.transaction(['CREATE ROLE "r"']));
    expect(stdins).toHaveLength(2);
    for (const stdin of stdins) expect(stdin.startsWith(PIN_SCRIPT_PREFIX)).toBe(true);
    // The pin comes BEFORE `BEGIN`: it is a session setting, not part of the transaction.
    expect(stdins[1]).toBe(`${PIN_SCRIPT_PREFIX}BEGIN;\nCREATE ROLE "r";\nCOMMIT;`);
  });

  test('the pin is the one statement text both transports share', () => {
    expect(PIN_SEARCH_PATH_SQL).toBe('SET search_path = pg_catalog, pg_temp');
  });
});

/** Every hand-written SQL builder in this family. The `*errors.ts` files are excluded: they name
 * catalogs in error-message PROSE, which no server ever parses. The fakes match on the qualified
 * text the builders emit, so their own tests pin them. */
const sources = readdirSync(import.meta.dir).filter(
  (f) =>
    f.endsWith('.ts') &&
    !f.endsWith('.test.ts') &&
    !f.startsWith('fake-') &&
    !/errors?\.ts$/.test(f),
);
const CATALOGS =
  /(?<![\w.])(pg_(?:namespace|class|proc|type|operator|roles|authid|auth_members|database|tablespace|attribute|default_acl|depend|constraint|trigger|rewrite|attrdef|policy))\b/g;

describe('catalog references', () => {
  test('no SQL builder names a catalog without the pg_catalog. qualifier', () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const text = readFileSync(`${import.meta.dir}/${file}`, 'utf8');
      // Only template/quoted SQL is judged: skip comment lines and `'pg_namespace'` literals
      // (an `obj_description` class argument is a string, not a relation reference).
      for (const [index, line] of text.split('\n').entries()) {
        const trimmed = line.trim();
        if (/^(\/\/|\*|\/\*)/.test(trimmed)) continue;
        for (const match of line.matchAll(CATALOGS)) {
          const before = line[(match.index ?? 0) - 1];
          if (before === "'" || before === '`') continue;
          offenders.push(`${file}:${String(index + 1)} ${match[1] ?? ''}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the scan sees the catalogs it is meant to police', () => {
    const joined = sources.map((f) => readFileSync(`${import.meta.dir}/${f}`, 'utf8')).join('\n');
    for (const needle of [
      'pg_catalog.pg_namespace',
      'pg_catalog.pg_class',
      'pg_catalog.pg_depend',
      'pg_catalog.pg_roles',
      'pg_catalog.pg_database',
    ]) {
      expect(joined).toContain(needle);
    }
  });

  test('the scan itself fails on an unqualified reference', () => {
    const bad = '  FROM pg_namespace n\n  JOIN pg_catalog.pg_class c ON true';
    const hits = [...bad.matchAll(CATALOGS)].map((m) => m[1]);
    expect(hits).toEqual(['pg_namespace']);
  });
});
