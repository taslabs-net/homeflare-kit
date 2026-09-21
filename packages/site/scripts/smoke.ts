/**
 * Consumer smoke test: pack the real tarball, install it with the pinned peer, and use
 * both entrypoints under bun AND node, then typecheck from the consumer's side.
 *
 * ★ WHAT ONLY THIS CATCHES (see packages/kit/scripts/smoke.ts for the full history): a
 *   `files` entry that misses site.example.json, an `exports` map that omits `./load` or
 *   the example, a split chunk that did not ship, and a .d.ts that names a file the
 *   tarball lacks. tests/dist.test.ts imports dist/ by path and sees none of those.
 *
 * ⛔ The consumer file touches no node globals on purpose: it passes `env` explicitly and
 *   finds the example through the package's own exported path, so the typecheck needs no
 *   @types/node and the same file runs unchanged on both runtimes.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packForPublish } from '../../../scripts/pack.ts';

const pkgRoot = new URL('../', import.meta.url).pathname;

/** The peer pin, exactly as the README's install line writes it. */
const PEER = 'effect@4.0.0-rc.115';

async function run(cmd: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn([...cmd], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`site smoke: \`${cmd.join(' ')}\` exited ${code} in ${cwd}\n${out}\n${err}`);
  }
  return out;
}

const CONSUMER = `import { SiteError, VERSION, compareIdentity, decodeSite, derive, expectedIdentity, tokenValues } from '@homeflare/site';
import { SITE_EXAMPLE, loadSite } from '@homeflare/site/load';

// The example, found where the refusal message says it is, through the exports map.
const loaded = await loadSite({ env: { HF_SITE_FILE: SITE_EXAMPLE }, siteDev: true });
if (loaded.site.deriveVersion !== VERSION) throw new Error('example deriveVersion is not VERSION');

const site = decodeSite(JSON.parse(JSON.stringify(loaded.site)));
const d = derive(site);
if (d.vault.apiHost !== 'api.v.example.com') throw new Error('derive: ' + d.vault.apiHost);
if (tokenValues(site)['<mgmt-zone>'] !== 'mgmt.example.com') throw new Error('tokens');
if (compareIdentity(expectedIdentity(site), { vaultClusterName: 'other', vaultNamespace: '' }).length !== 1) {
  throw new Error('identity comparator');
}

// ⛔ One class across both entrypoints (the reason build:js passes --splitting).
async function refusal(p: Promise<unknown>): Promise<unknown> {
  try { await p; } catch (e) { return e; }
  throw new Error('expected a refusal');
}
const missing = await refusal(loadSite({ env: {}, siteDev: true }));
if (!(missing instanceof SiteError) || missing.code !== 'load') throw new Error('SiteError identity');

// The checkout guard spawns git: the tarball in node_modules is not a reviewed checkout.
const unreviewed = await refusal(loadSite({ env: { HF_SITE_FILE: SITE_EXAMPLE } }));
if (!(unreviewed instanceof SiteError) || unreviewed.code !== 'checkout') throw new Error('checkout guard');

console.log('consumer ok', VERSION, d.vault.host);
`;

const scratch = await mkdtemp(join(tmpdir(), 'hf-site-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify({ name: 'site-smoke', private: true, type: 'module' }, null, 2),
  );

  console.log('installing as a consumer would…');
  await run(['bun', 'add', tarball, PEER], scratch);
  await Bun.write(join(scratch, 'consumer.ts'), CONSUMER);

  console.log('running under bun…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  // ⛔ NODE IS DELIBERATE: `/load` promises Node, and bun's resolver forgives things
  //   node's does not (an exports map gap, a missing chunk).
  console.log('running under node…');
  console.log(await run(['node', '--experimental-strip-types', 'consumer.ts'], scratch));

  // ⚠️ From the CONSUMER's side, skipLibCheck OFF: a .d.ts naming a file the tarball does
  //   not ship passes in this repo and fails only here.
  await Bun.write(
    join(scratch, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'esnext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ['consumer.ts'],
      },
      null,
      2,
    ),
  );
  console.log('typechecking as a nodenext consumer…');
  await run(['bun', 'add', '-d', 'typescript@7.0.2'], scratch);
  await run(['npx', 'tsc', '--noEmit'], scratch);

  console.log('\nsite smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
