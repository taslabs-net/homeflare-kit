/**
 * Consumer smoke test: pack the real tarball, install it, and import it.
 *
 * 🔴 WHY THIS REPLACES AN `echo`. The old script was
 *   `echo 'auth: no published surface yet — nothing to smoke'`, which was wrong on its own
 *   terms: the package publishes an entrypoint, declares peers, and depends on
 *   better-auth and a workspace copy of @homeflare/kit. All four can break a consumer's
 *   install while every in-repo gate stays green.
 * ★ A scaffold still has a contract. This asserts the contract it HAS — that it installs,
 *   resolves and exports VERSION — rather than pretending there is nothing to check.
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
  await run(
    [
      'bun',
      'add',
      authTarball,
      kitTarball,
      '@better-auth/drizzle-adapter@^1.5.0',
      '@cloudflare/workers-types@5.20260908.1',
    ],
    scratch,
  );

  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import { VERSION } from '@homeflare/auth';

if (typeof VERSION !== 'string' || VERSION.length === 0) throw new Error('VERSION missing');

// ⚠️ better-auth is a real dependency, so it must resolve from the installed tarball —
//   a missing or mis-declared dependency fails here rather than in a consumer's app.
const { betterAuth } = await import('better-auth');
if (typeof betterAuth !== 'function') throw new Error('better-auth did not resolve');

console.log('consumer ok', VERSION);
`,
  );

  console.log('importing…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\nauth smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
