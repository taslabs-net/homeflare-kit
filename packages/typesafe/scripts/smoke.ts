/**
 * Consumer smoke test: pack, install, and construct the official client.
 *
 * ⛔ No live TypeSafe call. Smoke proves the tarball resolves and the constructor runs;
 *   a network call would need a key and would bill.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packForPublish } from '../../../scripts/pack.ts';

const pkgRoot = new URL('../', import.meta.url).pathname;

async function run(cmd: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn([...cmd], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`typesafe smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`);
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-typesafe-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'typesafe-smoke', private: true, type: 'module' }, null, 2),
  );

  console.log('installing…');
  await run(['bun', 'add', tarball], scratch);

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import { TypeSafeClient, choice, createTypeSafeClient, createTypeSafeGatewayClient, gate, noul, VERSION } from '@homeflare/typesafe';

if (typeof VERSION !== 'string' || VERSION.length === 0) throw new Error('VERSION missing');
if (gate({}, { state: {}, questions: {} }).kind !== 'send') throw new Error('gate() did not send a clean empty payload');
const client = createTypeSafeClient({ apiKey: 'smoke-key' });
if (!(client instanceof TypeSafeClient)) throw new Error('not an official TypeSafeClient');
if (typeof choice !== 'function' || typeof noul !== 'function') throw new Error('helpers missing');

// No network call: fake ids only, proving the gateway client still IS a TypeSafeClient.
const gatewayClient = createTypeSafeGatewayClient({
  accountId: '0123456789abcdef0123456789abcdef',
  token: 'fake-token',
  gatewayId: 'example-gateway',
});
if (!(gatewayClient instanceof TypeSafeClient)) throw new Error('gateway client is not a TypeSafeClient');

console.log('consumer ok', VERSION);
`,
  );

  console.log('importing and exercising…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\ntypesafe smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
