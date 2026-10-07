/**
 * ⛔ THE PUBLISHED CODE RUNS ON NODE. A successful adapter connect is run under a real `node`
 * process (`node-connect.harness.ts`, type stripping), so a Bun-only API on the connect path fails
 * here. Reproduced before the fix: on Node 22 `Bun.YAML` was a missing global, swallowed into
 * "unreadable kubeconfig", and the adapter returned no transport. Bun's own test run cannot see
 * that, which is why this spawns node instead of importing the module.
 */
import { expect, test } from 'bun:test';

test('a successful connect works under node, with no Bun globals', async () => {
  const harness = new URL('./node-connect.harness.ts', import.meta.url).pathname;
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
  expect(JSON.parse(out.trim())).toEqual({
    endpoint: 'https://c1.cluster.invalid:6443',
    hasCert: true,
    seen: ['GET c1.cluster.invalid/api/v1/namespaces/kube-system'],
  });
});
