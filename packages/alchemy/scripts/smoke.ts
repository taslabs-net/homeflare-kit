/**
 * Consumer smoke test: pack the real tarball, install it the way the README says, and
 * import every subpath.
 *
 * 🔴 WHY THIS EXISTS. 0.1.0 published with `smoke: echo '…exercised by the consuming
 *   stack'` — a script that cannot fail. Three defects shipped behind it, all found by
 *   installing the published package by hand afterwards:
 *     1. `@effect/platform-node` was a devDependency, so a consumer got
 *        "Cannot find module '@effect/platform-node/NodeServices'" at import.
 *     2. The `effect` peer was ranged `>=4.0.0-rc.112`, which resolved to rc.115
 *        against Alchemy 77 — "TypeError: Config.string is not a function".
 *     3. Even pinned, `platform-node-shared` floats to the next rc — "Cannot find
 *        module 'effect/ByteSize'". Only an override holds the set.
 *   Alchemy 78's peer is `effect >= 4.0.0-rc.115`; the pin moved with it.
 *     4. Alchemy 78's cloudflare-runtime imported `mime` without declaring it.
 *        A clean consumer install threw `Cannot find package 'mime'`. 79
 *        declares it; the peer stays so a 78-era install line still works.
 *   `/cloudflare` also imports `@distilled.cloud/cloudflare` (MeshNode). It is alchemy's own
 *   dependency, so a hoisting installer hides a missing peer and a strict one (pnpm) does
 *   not; the install below names it, as the README does.
 *   ⛔ None of them failed at INSTALL. All three threw at import, which is why a test that
 *     only packs is not enough — this one imports.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packForPublish } from '../../../scripts/pack.ts';

const pkgRoot = new URL('../', import.meta.url).pathname;

/** The pinned set, mirroring what the README tells a consumer to write. */
const PINS = {
  effect: '4.0.0-rc.115',
  '@effect/platform-node': '4.0.0-rc.115',
  '@effect/platform-node-shared': '4.0.0-rc.115',
  '@effect/platform-bun': '4.0.0-rc.115',
  // ⛔ Exact, not `~1.2.6`. Measured 2026-09-16: vite's tilde resolved to rolldown
  //   1.2.9 and npm 404'd the tarball. 1.2.8 is the last version a green consumer
  //   install actually fetched (#37, five minutes earlier).
  rolldown: '1.2.8',
};

async function run(cmd: readonly string[], cwd: string): Promise<string> {
  const proc = Bun.spawn([...cmd], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`alchemy smoke: \`${cmd.join(' ')}\` exited ${code}\n${out}\n${err}`);
  }
  return out;
}

const scratch = await mkdtemp(join(tmpdir(), 'hf-alchemy-smoke-'));

try {
  console.log('packing…');
  const tarball = await packForPublish(pkgRoot, scratch);

  // ⛔ The overrides are part of the contract, so the smoke test writes them exactly as
  //   the README does. If the README and this file ever disagree, one of them is wrong.
  await Bun.write(
    join(scratch, 'package.json'),
    JSON.stringify(
      { name: 'alchemy-smoke', private: true, type: 'module', overrides: PINS },
      null,
      2,
    ),
  );

  console.log('installing as a consumer would…');
  await run(
    [
      'bun',
      'add',
      tarball,
      'alchemy@2.0.0-beta.79',
      'effect@4.0.0-rc.115',
      '@effect/platform-node@4.0.0-rc.115',
      'cloudflare@4.5.0',
      'mime@4.1.0',
      '@distilled.cloud/cloudflare@1.0.0-rc.12',
    ],
    scratch,
  );

  // ⛔ IMPORT EVERY SUBPATH. An export map that points at a missing file, or a module that
  //   throws on load, both pass a pack-only check and fail here.
  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import { MeshNode, MeshNodeError, MeshNodeProvider, R2BucketLock, astroWebsite, fetchMeshNodeToken, providers, viteWebsite } from '@homeflare/alchemy/cloudflare';
import { ForgejoOrgLabel } from '@homeflare/alchemy/forgejo';
import { BaoAuthMethod, BaoAuthRoleProvider, BaoJwtRole, BaoMfaLoginEnforcement, BaoPlugin, appRoleLogin, assertBaoIdentity, hostAppRoles } from '@homeflare/alchemy/openbao';
import { TalosKubeconfigProvider } from '@homeflare/alchemy/talos';
import { ProxmoxAclProvider } from '@homeflare/alchemy/proxmox';
import { HostFile, LaunchdJob, launchdProviders, renderPlist } from '@homeflare/alchemy/launchd';
import { CaddyConfig, caddyProviders, caddyWithFile, localCaddyAdmin } from '@homeflare/alchemy/caddy';

for (const [name, value] of Object.entries({
  MeshNode, MeshNodeProvider, fetchMeshNodeToken, providers,
  R2BucketLock, astroWebsite, viteWebsite, ForgejoOrgLabel, BaoAuthMethod, BaoAuthRoleProvider, BaoJwtRole, BaoMfaLoginEnforcement, BaoPlugin, appRoleLogin, assertBaoIdentity, hostAppRoles, TalosKubeconfigProvider, ProxmoxAclProvider,
  HostFile, LaunchdJob, launchdProviders, CaddyConfig, caddyProviders, caddyWithFile,
})) {
  if (value === undefined) throw new Error(name + ' is undefined');
}

// ★ Render once through the PUBLISHED file, so a launchd subpath that imports but cannot run
//   (a Bun-only API in dist, a node: builtin that fails to resolve) fails here, not in a stack.
if (!renderPlist({ Label: 'com.example.smoke' }).includes('<string>com.example.smoke</string>')) {
  throw new Error('renderPlist from dist did not render');
}

// ★ MeshNode's error type through the PUBLISHED file: a distilled SDK missing from the install
//   (it is a peer, like alchemy) throws at the import above, not in a stack days later.
if (new MeshNodeError({ message: 'smoke' }).message !== 'smoke') {
  throw new Error('MeshNodeError from dist did not construct');
}

// ★ The Caddy transport too: it builds its target from node:http, so a dist that cannot load that
//   (or a default that drifted off loopback) fails here. It sends nothing — no Caddy is needed.
if (localCaddyAdmin().endpoint !== 'http://127.0.0.1:2019') {
  throw new Error('localCaddyAdmin from dist lost its loopback default');
}
let refused = false;
try {
  localCaddyAdmin({ address: 'http://192.0.2.10:2019' });
} catch {
  refused = true;
}
if (!refused) throw new Error('localCaddyAdmin from dist accepted a non-loopback address');

console.log('all seven subpaths import and resolve');
`,
  );

  console.log('importing every subpath…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  console.log('\nalchemy smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
