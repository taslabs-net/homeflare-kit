/**
 * Publish every workspace package whose version is not yet on npm.
 *
 * ⛔ WHY NOT `changeset publish`. Measured 2026-09-15, and it would have shipped broken
 *   packages: changesets shells out to `npm publish`, and `npm pack` does NOT resolve
 *   either protocol bun uses.
 *     `workspace:*` publishes literally  -> consumer install fails (bun#24687,
 *                                           changesets/action#246, both open)
 *     `catalog:`    publishes literally  -> EUNSUPPORTEDPROTOCOL (changesets#2213, open)
 *   `bun pm pack` resolves both, so this packs with bun and publishes THAT TARBALL.
 *
 * ★ WHY NOT PLAIN `bun publish` EITHER. It resolves the protocols but has no
 *   `--provenance` flag (checked `bun publish --help` on 1.4.0). Publishing a prebuilt
 *   tarball with npm keeps the resolved manifest AND the attestation — each tool doing
 *   the half it is actually good at.
 *
 * ⚠️ IDEMPOTENT BY DESIGN. A version already on the registry is skipped, not retried:
 *   re-running after a partial failure must publish the remainder rather than erroring
 *   on the ones that worked. An npm version can never be reused, so a half-done release
 *   has to be safe to finish.
 */
import { Glob } from 'bun';

const root = new URL('..', import.meta.url);
const rootPkg = await Bun.file(new URL('package.json', root)).json();
const patterns: readonly string[] = rootPkg.workspaces ?? [];

type Pkg = { readonly name: string; readonly version: string; readonly dir: string };

/**
 * ⛔ `stream: true` FOR ANYTHING THAT TALKS TO THE REGISTRY. Measured 2026-09-15: this
 *   script captured npm's output and reported success from the EXIT CODE alone. It
 *   printed "+ @homeflare/kit@0.1.0 published" five times, the workflow went green, and
 *   nothing reached npm — the run log contained not one `npm notice` line to say so.
 *   A step that reports success it did not verify is worse than a failing one.
 */
async function run(
  cmd: readonly string[],
  cwd: string,
  stream = false,
): Promise<{ code: number; out: string }> {
  if (stream) {
    const proc = Bun.spawn([...cmd], { cwd, stdout: 'inherit', stderr: 'inherit' });
    return { code: await proc.exited, out: '' };
  }

  const proc = Bun.spawn([...cmd], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out: out + err };
}

/** Already on the registry? `npm view <pkg>@<version>` exits non-zero when not. */
async function isPublished(pkg: Pkg): Promise<boolean> {
  const { code } = await run(
    ['npm', 'view', `${pkg.name}@${pkg.version}`, 'version'],
    root.pathname,
  );
  return code === 0;
}

if (process.env['GITHUB_ACTIONS'] !== 'true') {
  console.warn('⚠️  not in CI: publishing without provenance. Releases should run from CI.\n');
}

/**
 * ⛔ REFRESH THE LOCKFILE BEFORE PACKING. `bun pm pack` reads the workspace version from
 *   bun.lock, NOT from the sibling package.json — so after `changeset version` bumps
 *   0.0.0 -> 0.1.0, packing still writes `"@homeflare/kit": "0.0.0"` into the tarball and
 *   publishes a dependency on a version that does not exist.
 * ⚠️ MEASURED 2026-09-15 against the real version PR, and neither `bun install` nor
 *   `bun install --force` fixed it — the entry is only rewritten when the lockfile is
 *   regenerated. Hence the delete.
 * ★ Nothing is lost: bun.lock is reconstructed from the manifests immediately below, and
 *   this runs on a CI checkout that is thrown away.
 */
await Bun.file(new URL('bun.lock', root))
  .delete()
  .catch(() => {});

const relock = await run(['bun', 'install'], root.pathname);
if (relock.code !== 0) throw new Error(`lockfile refresh failed\n${relock.out}`);

const packages: Pkg[] = [];

// oxlint-disable no-await-in-loop -- a handful of packages, once per release.
for (const pattern of patterns) {
  for await (const relative of new Glob(`${pattern}/package.json`).scan({ cwd: root.pathname })) {
    const manifestUrl = new URL(relative, root);
    const m = await Bun.file(manifestUrl).json();
    if (m.private === true) continue;

    packages.push({
      name: m.name,
      version: m.version,
      dir: new URL('./', manifestUrl).pathname,
    });
  }
}

let published = 0;

for (const pkg of packages) {
  if (await isPublished(pkg)) {
    console.log(`= ${pkg.name}@${pkg.version} already published`);
    continue;
  }

  // ⛔ bun packs (resolving workspace: and catalog:), npm publishes the result.
  const packed = await run(['bun', 'pm', 'pack', '--quiet'], pkg.dir);
  if (packed.code !== 0) throw new Error(`pack failed for ${pkg.name}\n${packed.out}`);

  const tarball = packed.out.trim().split('\n').at(-1) ?? '';
  if (!tarball.endsWith('.tgz')) throw new Error(`no tarball from ${pkg.name}: ${packed.out}`);

  // ⚠️ PROVENANCE ONLY WORKS IN CI. npm mints the attestation from the runner's OIDC
  //   identity, so on a laptop it fails with "Automatic provenance generation not
  //   supported for provider: null" — measured 2026-09-15, before anything was pushed.
  //   ⛔ The flag is therefore conditional, NOT dropped: a release from CI must always
  //     be attested, and silently publishing unattested would be the worse failure.
  const inCi = process.env['GITHUB_ACTIONS'] === 'true';
  const flags = ['--access', 'public', ...(inCi ? ['--provenance'] : [])];

  const result = await run(['npm', 'publish', tarball, ...flags], pkg.dir, true);
  if (result.code !== 0) throw new Error(`publish failed for ${pkg.name}`);

  // ⛔ ASK THE REGISTRY, DO NOT TRUST THE EXIT CODE. This is the check that would have
  //   caught the silent no-op above, and it is cheap.
  if (!(await isPublished(pkg))) {
    throw new Error(
      `${pkg.name}@${pkg.version}: npm exited 0 but the registry does not have it. ` +
        'Check the npm output above — the token may lack publish rights for this scope.',
    );
  }

  console.log(`+ ${pkg.name}@${pkg.version} published and confirmed on the registry`);
  published += 1;
}
// oxlint-enable no-await-in-loop

console.log(`\n${published} package(s) published, ${packages.length - published} already current`);

/**
 * ★ REPORT WHAT ACTUALLY HAPPENED, on the run's summary page. A release that says only
 *   "success" is the failure mode this script already had once: it claimed five
 *   publishes and made none. Every row below is confirmed against the registry.
 * ⚠️ No token, URL or credential is ever written here — a job summary is visible to
 *   anyone who can see the run.
 */
const summaryPath = process.env['GITHUB_STEP_SUMMARY'];
if (summaryPath !== undefined) {
  const rows = await Promise.all(
    packages.map(async (p) => {
      const live = await isPublished(p);
      return `| \`${p.name}\` | ${p.version} | ${live ? '✅ on npm' : '❌ MISSING'} |`;
    }),
  );

  const summary = [
    '## Release',
    '',
    '| package | version | registry |',
    '| --- | --- | --- |',
    ...rows,
    '',
    `> ${published} published this run, ${packages.length - published} already current.`,
    '> Each row was re-checked against registry.npmjs.org after publishing.',
    '',
  ].join('\n');

  await Bun.write(
    summaryPath,
    (await Bun.file(summaryPath)
      .text()
      .catch(() => '')) + summary,
  );
}
