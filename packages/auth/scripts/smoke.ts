/**
 * Consumer smoke test: pack the real tarball, install it, and import it.
 *
 * 🔴 WHY THIS REPLACES AN `echo`. The old script was
 *   `echo 'auth: no published surface yet — nothing to smoke'`, which was wrong on its own
 *   terms: the package publishes an entrypoint, declares peers, and depends on
 *   better-auth, the official drizzle adapter, and a workspace copy of @homeflare/kit.
 *   All four can break a consumer's install while every in-repo gate stays green.
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
    throw new Error(`auth smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`);
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-auth-smoke-'));

try {
  console.log('packing…');
  const authTarball = await packForPublish(pkgRoot, scratch);
  const kitTarball = await packForPublish(join(pkgRoot, '../kit'), scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'auth-smoke', private: true, type: 'module' }, null, 2),
  );

  console.log('installing with its peers…');
  await run(['bun', 'add', authTarball, kitTarball, 'drizzle-orm@0.45.2'], scratch);

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import { VERSION, createWorkersAuth } from '@homeflare/auth';

if (typeof VERSION !== 'string' || VERSION.length === 0) throw new Error('VERSION missing');
if (typeof createWorkersAuth !== 'function') throw new Error('createWorkersAuth missing');

const auth = createWorkersAuth({
  db: {},
  schema: {},
  waitUntil: () => undefined,
  secret: 'a'.repeat(32),
  request: new Request('https://auth.example/'),
  advanced: { database: { validateSchema: false } },
});
if (typeof auth.handler !== 'function') throw new Error('handler missing');

const manifest = await Bun.file(new URL('./node_modules/@homeflare/auth/package.json', import.meta.url)).json();
if (manifest.dependencies?.['better-auth-cloudflare'] !== undefined) {
  throw new Error('published auth still depends on better-auth-cloudflare');
}

console.log('consumer ok', VERSION);
`,
  );

  console.log('importing…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\nauth smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
