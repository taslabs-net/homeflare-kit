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
import { packForPublish } from './pack.ts';
import { isAlreadyPublishedConflict } from './publish-conflict.ts';

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
 *
 * ⚠️ UPDATED 2026-09-23: `stream` used to mean `stdout/stderr: 'inherit'`, which shows
 *   npm's output live but throws it away — `out` came back `''`, so nothing could ever
 *   read what npm actually said. That is exactly what let a 409 "already published"
 *   conflict read as an unexplained failure and abort the release (see
 *   publish-conflict.ts). So this now PIPES either way and echoes the combined text for
 *   a streamed call once the process exits, instead of letting the OS inherit it live.
 *   The guarantee that comment demands — every byte npm wrote reaches the log — still
 *   holds; only the timing changed, from live to "immediately after this command ends,"
 *   which for one npm publish call is not a meaningful difference.
 */
async function run(
  cmd: readonly string[],
  cwd: string,
  stream = false,
): Promise<{ code: number; out: string }> {
  const proc = Bun.spawn([...cmd], { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const combined = out + err;
  if (stream && combined !== '') process.stdout.write(combined);
  return { code: await proc.exited, out: combined };
}

/**
 * Already on the registry? Exits non-zero when not.
 *
 * ★ `bun pm view`, not `npm view` — same exit-code contract, one fewer runtime in the
 *   release path. Verified 2026-09-16: an existing version exits 0, an absent one exits 1.
 * ⚠️ `npm publish` below stays npm, and that is not an oversight: `bun publish` has no
 *   `--provenance` flag (checked on 1.4.0), so npm is what signs the attestation.
 */
async function isPublished(pkg: Pkg): Promise<boolean> {
  const { code } = await run(
    ['bun', 'pm', 'view', `${pkg.name}@${pkg.version}`, 'version'],
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
  // ★ The SHARED pack path — the same one the smoke tests use, so a tarball defect
  //   cannot hide between them. See scripts/pack.ts.
  const tarball = await packForPublish(pkg.dir, pkg.dir);

  // ⚠️ PROVENANCE ONLY WORKS IN CI. npm mints the attestation from the runner's OIDC
  //   identity, so on a laptop it fails with "Automatic provenance generation not
  //   supported for provider: null" — measured 2026-09-15, before anything was pushed.
  //   ⛔ The flag is therefore conditional, NOT dropped: a release from CI must always
  //     be attested, and silently publishing unattested would be the worse failure.
  const inCi = process.env['GITHUB_ACTIONS'] === 'true';
  const flags = ['--access', 'public', ...(inCi ? ['--provenance'] : [])];

  const result = await run(['npm', 'publish', tarball, ...flags], pkg.dir, true);
  if (result.code !== 0) {
    // ⚠️ MEASURED 2026-09-23, run 35887402292: `isPublished()` above raced npm's own CDN
    //   lag (same lag as the ⚠️ note just below) and read an already-published version as
    //   absent, so this ran `npm publish` again and npm answered 409 "already published".
    //   The old code threw on ANY non-zero exit here and aborted the release before it
    //   reached @homeflare/config@0.11.0 — see publish-conflict.ts for the full story,
    //   the exact npm text, and why the match stays narrow (a 409 is not always this).
    // ⛔ A DIFFERENT reason to fail must still abort. Only a 409 whose text says THIS
    //   version was already staged or published is safe to treat as a no-op; anything
    //   else — permissions, a missing package, the network, an unrelated 409 — throws
    //   exactly as before.
    if (!isAlreadyPublishedConflict(result, pkg.version)) {
      throw new Error(`publish failed for ${pkg.name}`);
    }
    console.log(`~ ${pkg.name}@${pkg.version} already published (npm 409 after the fact)`);
    // ★ No ndjson entry, deliberately. The run that actually got this version onto npm
    //   already wrote its git-tag event and changesets/action already created the tag and
    //   the GitHub Release from it. Writing a second event here would tell the action to
    //   push a tag that exists and create a release that exists — a duplicate, not a
    //   correction. Not incrementing `published` is deliberate too: this run published
    //   nothing for this package, it just found out late that an earlier run had.
    continue;
  }

  // ⛔ VERIFICATION IS A WARNING HERE, NOT A GATE — and that is the whole lesson.
  // ⚠️ MEASURED TWICE, 2026-09-15, AND IT COST TWO RELEASES. npm says it plainly: "Your
  //   package is being processed and may take a few minutes to become available." A
  //   publish is ACCEPTED long before it is READABLE. First I failed on an immediate
  //   404 (kit@0.1.1 aborted the run); then I polled 60s and failed anyway
  //   (cloudflare@0.1.1). Both packages were fine — both are on the registry now.
  // ⛔ SO THE ABORT WAS ALWAYS THE BUG. A publish that npm accepted must not stop the
  //   remaining packages from publishing: that turns a slow CDN into a half-released
  //   workspace, which is far worse than the silent no-op the check was added for.
  //   The end-of-run summary reports what the registry can actually see, and the script
  //   is idempotent, so anything genuinely missing publishes on the next run.
  // ★ npm's exit code IS trustworthy for the publish itself. The original incident that
  //   prompted this check was a misdiagnosis on my part — CDN lag read as a failure.

  // ⛔ TELL changesets/action WHAT WE PUBLISHED. It reads this ndjson file to create the
  //   git tag and the GitHub Release for each package — with a custom publish-script it
  //   has no other way to know. Without it the action warns "GitHub releases and git tags
  //   cannot be created without this output", npm has the version and GitHub shows no
  //   release at all, which is exactly what happened for 0.1.0 and 0.1.1.
  // ★ Shape is fixed by the action: {type:"git-tag", tag, packageName}, one JSON object
  //   per line, tag in the conventional `<name>@<version>` form.
  const outputFile = process.env['CHANGESETS_OUTPUT'];
  if (outputFile !== undefined) {
    const event = { type: 'git-tag', tag: `${pkg.name}@${pkg.version}`, packageName: pkg.name };
    const prior = await Bun.file(outputFile)
      .text()
      .catch(() => '');
    await Bun.write(outputFile, `${prior}${JSON.stringify(event)}\n`);
  }

  console.log(`+ ${pkg.name}@${pkg.version} published`);
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
      // ⚠️ "not visible yet" is NOT "missing". npm accepts a publish before it serves it,
      //   so a row can read as pending on a release that worked perfectly. Say that,
      //   rather than crying wolf on every slow propagation.
      return `| \`${p.name}\` | ${p.version} | ${live ? '✅ on npm' : '⏳ not visible yet'} |`;
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
    '> Re-checked against registry.npmjs.org. ⏳ means npm accepted the publish but is',
    '> not serving it yet — it usually appears within a few minutes.',
    '',
  ].join('\n');

  await Bun.write(
    summaryPath,
    (await Bun.file(summaryPath)
      .text()
      .catch(() => '')) + summary,
  );
}
