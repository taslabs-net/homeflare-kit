/**
 * "An exception without a reason must not typecheck" — asserted by running the compiler.
 *
 * ★ A TYPE-LEVEL ASSERTION WOULD NOT HAVE BEEN ENOUGH. `type _ = Equals<Stated<''>, never>`
 *   proves a conditional type, not that the CALL is rejected; inference, `const` type
 *   parameters and excess-property checking all sit between the two, and any of them could
 *   change and leave a reasonless exception compiling while the type-level assertion still
 *   passed. This runs `tsc` and reads the diagnostics, which is what a person would do.
 *
 * ★ ONE REFUSAL PER FIXTURE FILE, so the assertion is "this file errored" and no line
 *   number in a test has to survive the formatter. The first draft asserted line numbers
 *   and broke the moment `oxfmt` wrapped one of the calls (measured 2026-09-22).
 *
 * ⚠️ IT ALSO ASSERTS THE GOOD FIXTURE COMPILES. A guard that refuses every call would pass
 *   the negative half alone, and the symptom would be a house rule nobody can satisfy.
 */
import { describe, expect, test } from 'bun:test';

const FIXTURES = new URL('./type-fixtures/', import.meta.url).pathname;
const TSC = new URL('../../../node_modules/typescript/bin/tsc', import.meta.url).pathname;

/** Files whose calls must be refused. One call each; the name is the assertion. */
const REFUSED = ['no-reason.ts', 'computed-reason.ts', 'job-no-reason.ts'];

/**
 * ⛔ `tsc -p`, NOT FILES ON THE COMMAND LINE. TypeScript 7 refuses to run with files on
 *   the command line while a tsconfig.json is present (TS5112), and `--ignoreConfig` then
 *   drops `skipLibCheck` and `types` as well — which made the GOOD fixture fail on
 *   unrelated @types/node collisions rather than on the thing under test (measured
 *   2026-09-22). A project file per fixture set inherits the settings this package ships.
 */
async function compile(project: string): Promise<string> {
  const proc = Bun.spawn([process.execPath, TSC, '-p', `${FIXTURES}${project}`], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const text = `${await new Response(proc.stdout).text()}${await new Response(proc.stderr).text()}`;
  await proc.exited;
  return text;
}

describe('the exceptions model is enforced by the compiler', () => {
  test('every way of omitting a reason is refused', async () => {
    const text = await compile('tsconfig.refused.json');

    // ⚠️ Asserted per FILE, not as a count of diagnostics: one call can emit several, and
    //   "three errors" would break on a compiler that says more about the same mistake.
    //   What matters is that no refusal silently started compiling.
    for (const fixture of REFUSED) expect(text).toContain(fixture);
    expect(text).toContain("not assignable to type 'never'");
  }, 60_000);

  test('the same calls with written reasons do typecheck', async () => {
    expect((await compile('tsconfig.stated.json')).trim()).toBe('');
  }, 60_000);
});
