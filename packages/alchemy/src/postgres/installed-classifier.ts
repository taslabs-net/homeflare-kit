/**
 * The installed `@effect/sql-pg` classifier, for tests that must pin real driver behavior
 * instead of a hand-built error shape.
 *
 * ⛔ TEST-ONLY, PINNED TO THE INSTALLED DRIVER. `@effect/sql-pg` nulls the `./internal/*`
 * export, so the public specifier cannot name `src/internal/sqlError.ts`; the file URL is
 * resolved from the installed package's `package.json` — the same module
 * `PgConnection.ts#classifyFields` calls. If the driver moves the file, the import fails
 * loudly in the tests that use it rather than silently asserting a fabricated shape.
 */
import { SqlError } from 'effect/unstable/sql/SqlError';

export const classifyInstalled = async (
  code: string,
  message = 'dependent objects still exist',
): Promise<SqlError> => {
  // `package.json` sets `"./internal/*": null`, so the specifier cannot name this file.
  // `import.meta.resolve` finds the installed package; `src/internal/sqlError.ts` is the
  // module `PgConnection.ts#classifyFields` calls.
  const root = import.meta.resolve('@effect/sql-pg/package.json');
  const href = new URL('./src/internal/sqlError.ts', root).href;
  const mod = (await import(href)) as {
    classifySqlState: (
      code: string | undefined,
      constraint: unknown,
      props: { cause: unknown; message: string; operation: string },
    ) => SqlError['reason'];
  };
  return new SqlError({
    reason: mod.classifySqlState(code, undefined, {
      cause: Object.assign(new Error(message), { code, message }),
      message: `ERROR:  ${code}: ${message}`,
      operation: 'DROP SCHEMA',
    }),
  });
};
