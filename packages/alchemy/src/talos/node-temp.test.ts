/**
 * ⛔ The temp-file minters (credentials.ts `mintKvTempFile`, credentials-write.ts `reservedTempPath`)
 *   run on Node in production. They once read `Bun.env`/`Bun.randomUUIDv7`; a Node process would
 *   throw `ReferenceError: Bun is not defined`. This spawns a real `node` process (type stripping) so
 *   a Bun-only API on that path fails here rather than in a consumer's deploy.
 */
import { expect, test } from 'bun:test';

test('the temp-file minters work under node, with no Bun globals', async () => {
  const harness = new URL('./node-temp.harness.ts', import.meta.url).pathname;
  const proc = Bun.spawn(['node', '--experimental-strip-types', '--no-warnings', harness], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect({ code, err: err.slice(0, 500) }).toEqual({ code: 0, err: '' });
  const line = out.trim().split('\n').pop() ?? '';
  expect(JSON.parse(line)).toEqual({
    label: 'temp',
    value: { tempCreated: true, tempMode: 0o600, tempGone: true, reservedGone: true },
  });
});
