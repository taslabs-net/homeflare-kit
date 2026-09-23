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
 *   `/cloudflare` imports `@distilled.cloud/cloudflare` (R2BucketLock and MeshNode both, since
 *   2026-09-23). It is alchemy's own dependency, so a hoisting installer hides a missing peer
 *   and a strict one (pnpm) does not; the install below names it, as the README does.
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
      'mime@4.1.0',
      '@distilled.cloud/cloudflare@1.0.0-rc.12',
      '@effect/sql-pg@4.0.0-rc.115',
    ],
    scratch,
  );

  // ⛔ IMPORT EVERY SUBPATH. An export map that points at a missing file, or a module that
  //   throws on load, both pass a pack-only check and fail here.
  await Bun.write(
    join(scratch, 'consumer.ts'),
    `import { MeshNode, MeshNodeError, MeshNodeProvider, R2BucketLock, astroWebsite, fetchMeshNodeToken, providers, viteWebsite } from '@homeflare/alchemy/cloudflare';
import { ForgejoOrgLabel } from '@homeflare/alchemy/forgejo';
import { declareRepoPolicy, repoPolicy } from '@homeflare/alchemy/github';
import { BaoAuthMethod, BaoAuthRoleProvider, BaoJwtRole, BaoMfaLoginEnforcement, BaoPlugin, appRoleLogin, assertBaoIdentity, hostAppRoles } from '@homeflare/alchemy/openbao';
import { TalosKubeconfigProvider } from '@homeflare/alchemy/talos';
import { PROVISION_PRIVILEGES, PbsNotificationMatcher, PbsNotificationTarget, PbsNotificationTargetProvider, ProxmoxAclProvider, ProxmoxLxc, ProxmoxLxcProvider, ProxmoxNotificationMatcher, alertmanagerAlertBody, declareProvisionBaseline, provisionBootstrap } from '@homeflare/alchemy/proxmox';
import { NETBOX_CONSTRAINTS_DIGEST, NetboxPrefix, bodyViolations, constraintsFor } from '@homeflare/alchemy/netbox';
import { PostgresDatabase, isPostgresDatabase, nameByteRefusal, quoteIdent } from '@homeflare/alchemy/postgres';
import { HostFile, LaunchdJob, launchdProviders, renderPlist, sudoRunner } from '@homeflare/alchemy/launchd';
import { PAPERLESS_CONSTRAINTS_DIGEST, Tag as PaperlessTag, bodyViolations as paperlessBodyViolations, constraintsFor as paperlessConstraintsFor } from '@homeflare/alchemy/paperless';
import { HostDirectory, RemoteFile, SystemdTimer, SystemdUnit, linuxProviders, renderUnit, sshRunner } from '@homeflare/alchemy/linux';
import { ReleaseBinary, VICTORIA_RELEASES, catalogBinary, identifyBinary, releaseProviders, releaseUrl } from '@homeflare/alchemy/release';
import { CaddyConfig, caddyProviders, caddyWithFile, localCaddyAdmin } from '@homeflare/alchemy/caddy';
import { LITELLM_PROXY_API_KEY_ENV, LITELLM_PROXY_URL_ENV, LitellmCredentialsError, isLiteLLMPassThroughEndpoint, litellmProviders } from '@homeflare/alchemy/litellm';
import { parseVerifyArgs, verifySession, verifyStack } from '@homeflare/alchemy/verify';

for (const [name, value] of Object.entries({
  MeshNode, MeshNodeProvider, fetchMeshNodeToken, providers,
  R2BucketLock, astroWebsite, viteWebsite, ForgejoOrgLabel, declareRepoPolicy, repoPolicy, BaoAuthMethod, BaoAuthRoleProvider, BaoJwtRole, BaoMfaLoginEnforcement, BaoPlugin, appRoleLogin, assertBaoIdentity, hostAppRoles, TalosKubeconfigProvider, ProxmoxAclProvider, ProxmoxLxc, ProxmoxLxcProvider, declareProvisionBaseline,
  PbsNotificationMatcher, PbsNotificationTarget, PbsNotificationTargetProvider, ProxmoxNotificationMatcher,
  HostFile, LaunchdJob, launchdProviders, sudoRunner, CaddyConfig, caddyProviders, caddyWithFile,
  NetboxPrefix, bodyViolations, constraintsFor, NETBOX_CONSTRAINTS_DIGEST,
  PaperlessTag, paperlessBodyViolations, paperlessConstraintsFor, PAPERLESS_CONSTRAINTS_DIGEST,
  PostgresDatabase, isPostgresDatabase, nameByteRefusal, quoteIdent,
  HostDirectory, RemoteFile, SystemdTimer, SystemdUnit, linuxProviders, sshRunner, ReleaseBinary, releaseProviders,
  parseVerifyArgs, verifySession, verifyStack,
  litellmProviders, LitellmCredentialsError,
})) {
  if (value === undefined) throw new Error(name + ' is undefined');
}

// ★ Render once through the PUBLISHED file, so a launchd subpath that imports but cannot run
//   (a Bun-only API in dist, a node: builtin that fails to resolve) fails here, not in a stack.
if (!renderPlist({ Label: 'com.example.smoke' }).includes('<string>com.example.smoke</string>')) {
  throw new Error('renderPlist from dist did not render');
}

// ★ The Linux subpath's renderer through the PUBLISHED file, for the same reason: it is the one
//   pure function the systemd family exposes, and a dist that cannot load node:crypto fails here.
if (renderUnit([{ lines: [['ExecStart', '/bin/true']], name: 'Service' }]) !== '[Service]\\nExecStart=/bin/true\\n') {
  throw new Error('renderUnit from dist did not render');
}

// ★ The Victoria data set through the PUBLISHED file — pure, no network: an export map that resolved
//   /release to a file without the pins would import fine and then install nothing verifiable.
const vmalert = catalogBinary(VICTORIA_RELEASES, { binary: 'vmalert', package: 'vmutils', platform: 'darwin-arm64', version: '1.151.0' });
const vmalertUrl = releaseUrl(vmalert.archive.repo, vmalert.archive.tag, vmalert.archive.asset);
if (!vmalertUrl.endsWith('/v1.151.0/vmutils-darwin-arm64-v1.151.0.tar.gz') || identifyBinary([VICTORIA_RELEASES], vmalert.sha256)?.binary !== 'vmalert') {
  throw new Error('the Victoria data set from dist lost its vmalert pin');
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

// ★ The provisioning baseline through the PUBLISHED file: the bootstrap is pure, so generating it
//   proves the list and the generator both reached dist.
if (PROVISION_PRIVILEGES.length !== 27 || !provisionBootstrap().startsWith('#!/bin/sh')) {
  throw new Error('the provisioning baseline from dist is incomplete');
}

// ★ The Alertmanager body through the PUBLISHED file: pure text, so building it proves the helper
//   reached dist, and its refusal proves the guard did too. PbsNotificationTarget's module imports
//   node:crypto for its seal, which the import line above has already loaded.
const alertBody = alertmanagerAlertBody();
if (!alertBody.startsWith('[') || !alertBody.includes('{{ json message }}')) {
  throw new Error('alertmanagerAlertBody from dist did not build the template');
}
let braces = false;
try {
  alertmanagerAlertBody({ alertname: '{{ x }}' });
} catch {
  braces = true;
}
if (!braces) throw new Error('alertmanagerAlertBody from dist accepted template syntax');

if (parseVerifyArgs(['--stage', 'live'], {}).kind !== 'run') {
  throw new Error('parseVerifyArgs from dist did not parse');
}

// ★ The repository policy through the PUBLISHED file: pure props, so building them proves
//   the form reached dist, and its refusal proves the auto-merge guard did too. It declares
//   nothing and reaches no GitHub — the resources only exist inside declareRepoPolicy.
const policy = repoPolicy({ owner: 'o', repository: 'r', checks: ['b', 'a', 'a'] });
if (policy.repository.allowMergeCommit !== false || policy.ruleset.rules?.nonFastForward !== true) {
  throw new Error('repoPolicy from dist lost the house policy');
}
if (JSON.stringify(policy.ruleset.rules?.requiredStatusChecks?.checks) !== '[{"context":"a"},{"context":"b"}]') {
  throw new Error('repoPolicy from dist did not sort and de-duplicate its checks');
}
let merged = false;
try {
  repoPolicy({ owner: 'o', repository: 'r', checks: [] });
} catch {
  merged = true;
}
if (!merged) throw new Error('repoPolicy from dist allowed auto-merge with no required check');
// ★ And the ref guard: an exclude that cancels every include is a ruleset over nothing,
//   which is the same unchecked merge reached by a door that reads as a narrowing.
let scoped = false;
try {
  repoPolicy({ owner: 'o', repository: 'r', checks: ['ci'], exclude: ['~DEFAULT_BRANCH'] });
} catch {
  scoped = true;
}
if (!scoped) throw new Error('repoPolicy from dist allowed an exclude that matches no ref');

// ★ THE NETBOX TABLE THROUGH THE PUBLISHED FILE. The constraint data is a GENERATED module the
//   bundler inlines, so a build that tree-shook it away — or an export map that resolved the
//   subpath to a file without it — would pass the import above and then refuse nothing at all on
//   a consumer's plan. Exercising a real vendor limit is the only way that failure is visible.
if (constraintsFor('netbox:POST /api/ipam/prefixes/')['description']?.maxLength !== 200) {
  throw new Error('NetBox constraint table from dist lost the vendor maxLength');
}
if (bodyViolations('netbox:POST /api/ipam/prefixes/', { description: 'x'.repeat(201), prefix: '10.0.0.0/24' }, true).length !== 1) {
  throw new Error('NetBox constraint reader from dist stopped refusing an over-long description');
}
if (!/^[0-9a-f]{16}$/.test(NETBOX_CONSTRAINTS_DIGEST)) {
  throw new Error('NetBox constraint digest from dist is not a digest');
}

// ★ THE PAPERLESS TABLE THROUGH THE PUBLISHED FILE, same reasoning as NetBox's above.
if (paperlessConstraintsFor('paperless:POST /api/tags/')['name']?.maxLength !== 128) {
  throw new Error('Paperless constraint table from dist lost the vendor maxLength');
}
if (paperlessBodyViolations('paperless:POST /api/tags/', { name: 'x'.repeat(129) }, true).length !== 1) {
  throw new Error('Paperless constraint reader from dist stopped refusing an over-long name');
}
if (!/^[0-9a-f]{16}$/.test(PAPERLESS_CONSTRAINTS_DIGEST)) {
  throw new Error('Paperless constraint digest from dist is not a digest');
}
if (PaperlessTag === undefined) throw new Error('Paperless.Tag from dist is undefined');

// ★ THE LITELLM SUBPATH THROUGH THE PUBLISHED FILE. Pure checks only — no LiteLLM proxy is
//   reached: the env-var names LiteLLM's own CLI uses (credentials.ts), the resource's tag
//   string, and the typed credentials error construct the way MeshNodeError does above.
if (LITELLM_PROXY_URL_ENV !== 'LITELLM_PROXY_URL' || LITELLM_PROXY_API_KEY_ENV !== 'LITELLM_PROXY_API_KEY') {
  throw new Error('litellm credential env var names from dist do not match the vendor CLI');
}
if (!isLiteLLMPassThroughEndpoint({ Type: 'LiteLLM.PassThroughEndpoint' }) || isLiteLLMPassThroughEndpoint({})) {
  throw new Error('isLiteLLMPassThroughEndpoint from dist lost its resource type guard');
}
if (new LitellmCredentialsError({ message: 'smoke' }).message !== 'smoke') {
  throw new Error('LitellmCredentialsError from dist did not construct');
}
if (typeof litellmProviders !== 'function') {
  throw new Error('litellmProviders from dist is not callable');
}
// ★ THE POSTGRES SUBPATH THROUGH THE PUBLISHED FILE: a pure name-length refusal and the
//   identifier quoter, so an export map pointing at a missing file fails here, not in a stack.
if (!isPostgresDatabase(PostgresDatabase) || quoteIdent('a"b') !== '"a""b"') {
  throw new Error('postgres subpath from dist lost isPostgresDatabase or quoteIdent');
}
if (nameByteRefusal('a'.repeat(64))?.byteLength !== 64 || nameByteRefusal('a'.repeat(63)) !== undefined) {
  throw new Error('postgres subpath from dist lost the NAMEDATALEN byte-length refusal');
}

console.log('all fifteen subpaths import and resolve');
`,
  );

  console.log('importing every subpath…');
  console.log(await run(['bun', 'consumer.ts'], scratch));

  // ⛔ THE BIN THROUGH npm's OWN LINK, under node — the runtime the published dist targets. A
  //   `bin` pointing at a missing file, a lost shebang or a dist that cannot load its imports all
  //   pass the import above and fail here. Under bun it also needs `@effect/platform-bun`, as the
  //   Alchemy CLI does, which a consumer of this README does not install — so node is the check.
  console.log('running hf-adopt-verify --help under node…');
  const help = await run(['node', 'node_modules/.bin/hf-adopt-verify', '--help'], scratch);
  if (!help.includes('Usage: hf-adopt-verify'))
    throw new Error('hf-adopt-verify --help printed no usage');

  console.log('\nalchemy smoke: ok');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
