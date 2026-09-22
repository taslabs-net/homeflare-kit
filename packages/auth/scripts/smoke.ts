/**
 * Consumer smoke test: pack the real tarball, install it with its peers, and use it.
 *
 * 🔴 WHY THIS REPLACES AN `echo`. The old script was
 *   `echo 'auth: no published surface yet — nothing to smoke'`, which was wrong on its own
 *   terms: the package publishes an entrypoint and declares peers. All of that can break
 *   a consumer's install while every in-repo gate stays green.
 * ★ Now there is a real surface. This asserts the contract it HAS — that it installs
 *   with the official adapter (not better-auth-cloudflare), and that
 *   `createD1AuthStorage` returns `{ db, database }` without calling `betterAuth()`.
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

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'auth-smoke', private: true, type: 'module' }, null, 2),
  );

  console.log('installing with its peers…');
  await run(
    [
      'bun',
      'add',
      authTarball,
      'better-auth@1.7.5',
      'drizzle-orm@0.45.2',
      '@better-auth/drizzle-adapter@1.7.5',
    ],
    scratch,
  );

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import { createD1AuthStorage, VERSION } from '@homeflare/auth';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

if (typeof VERSION !== 'string' || VERSION.length === 0) throw new Error('VERSION missing');
if (typeof createD1AuthStorage !== 'function') throw new Error('createD1AuthStorage missing');

const user = sqliteTable('user', { id: text('id').primaryKey() });
const fake = { prepare() { throw new Error('smoke does not query'); } };
const { db, database } = createD1AuthStorage(fake, { user });

if (typeof database !== 'function') throw new Error('database is not the adapter factory');
if (db.$client !== fake) throw new Error('$client was not the binding we passed');
if ('api' in db || 'handler' in db) throw new Error('looks like an auth instance, not storage');

// ⛔ The community adapter must not come along for the ride.
try {
  await import('better-auth-cloudflare');
  throw new Error('better-auth-cloudflare resolved — it must not');
} catch (err) {
  if (err instanceof Error && err.message.includes('must not')) throw err;
}

console.log('consumer ok', VERSION);
`,
  );

  console.log('importing and exercising…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\nauth smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
