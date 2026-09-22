/**
 * `hf-adopt-verify` as a stack would run it: a separate process that imports an entrypoint from
 * disk through Alchemist.open, plans it, and exits with the verdict.
 *
 * ★ THE ONLY TEST THAT GOES THROUGH `Alchemist.layer()` AND `open`. src/verify/verify.test.ts drives
 *   `verifySession` over a compiled stack; this one proves the bin wires the same session the
 *   Alchemy CLI builds, from flags alone. tests/fixtures/verify-stack.ts has an in-memory store and
 *   a fake family, so nothing leaves the machine.
 * ⚠️ HOME AND THE WORKING DIRECTORY ARE SCRATCH. Alchemy's session writes a run log under
 *   `.alchemy/log` in the working directory and reads profiles under `$HOME/.alchemy`, exactly as
 *   `alchemy plan` does; neither should land in this repo or in the developer's home.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = new URL('../src/verify/cli.ts', import.meta.url).pathname;
const fixture = new URL('fixtures/verify-stack.ts', import.meta.url).pathname;
const scratch = mkdtempSync(join(tmpdir(), 'hf-adopt-verify-'));

afterAll(() => rmSync(scratch, { force: true, recursive: true }));

const run = async (...flags: string[]) => {
  const env: Record<string, string | undefined> = { ...process.env, HOME: join(scratch, 'home') };
  delete env['ALCHEMY_STAGE'];
  const proc = Bun.spawn(['bun', cli, '--config', fixture, ...flags], {
    cwd: scratch,
    env,
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stderr, stdout };
};

describe('hf-adopt-verify', () => {
  test('reports each row without state and exits 1 when any is not a no-op', async () => {
    const { code, stdout } = await run('--stage', 'test');
    expect(code).toBe(1);
    expect(stdout).toContain('VerifyFixture/test: 3 rows without state');
    expect(stdout).toMatch(/ok {4}adopted +noop +found +Test\.Thing +same/);
    expect(stdout).toMatch(/FAIL +adopted +update +found +Test\.Thing +drifted +changed: comment/);
    expect(stdout).toMatch(/FAIL +create +not-run +absent +Test\.Thing +fresh/);
  }, 30_000);

  test('prints the same report as JSON', async () => {
    const { code, stdout } = await run('--stage', 'test', '--json');
    expect(code).toBe(1);
    const report = JSON.parse(stdout) as { rows: { fqn: string; ok: boolean; diff: string }[] };
    expect(report.rows.map((row) => [row.fqn, row.diff, row.ok])).toEqual([
      ['drifted', 'update', false],
      ['fresh', 'not-run', false],
      ['same', 'noop', true],
    ]);
  }, 30_000);

  test('exits 2 without a stage, and 2 when the entrypoint cannot be imported', async () => {
    expect((await run()).code).toBe(2);
    const missing = await run('--stage', 'test', '--config', join(scratch, 'nope.ts'));
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('could not be verified');
  }, 30_000);
});
