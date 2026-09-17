/**
 * No npm publish. Tag a GitHub Release — but ONLY when this version genuinely just
 * came out of `changeset version`, never on an arbitrary changeset-less push to main.
 *
 * 🔴 MEASURED 2026-09-16/17 on homeflare-openbao, and documented upstream
 *   (changesets/action's own README, changesets/action#9): a custom publish-script runs
 *   on EVERY push to `main` that has zero pending changesets — not just the one push
 *   right after a Version Packages PR merges. The README says so directly: "a commit
 *   without any new changesets can always land on your base branch after a successful
 *   publish... you need to figure out on your own how to skip." Unguarded, this would
 *   tag `<name>@<version>` on every unrelated push to main once CHANGELOG.md exists.
 *
 * ★ THE CONDITION: proceed only if `CHANGELOG.md` has an entry for the current version
 *   (proof `changeset version` really ran and wrote it) AND no git tag `<name>@<version>`
 *   exists yet (proof this exact release was not already cut). Both checks are local —
 *   no network, no GitHub API — and both work from the checkout `release.yml` already
 *   has (`fetch-depth: 0`).
 *
 * ⛔ TELL changesets/action WHAT TO TAG. With a custom publish-script it learns what
 *   shipped only from `CHANGESETS_OUTPUT`. Without it, the action warns "GitHub releases
 *   and git tags cannot be created without this output" and creates neither.
 */
type Pkg = { readonly name: string; readonly version: string };

/**
 * Does CHANGELOG.md have a heading for this exact version?
 * @changesets/changelog-github writes `## <version>` for a single, non-monorepo package.
 */
export async function changelogHasEntry(cwd: string, version: string): Promise<boolean> {
  const file = Bun.file(`${cwd}/CHANGELOG.md`);
  if (!(await file.exists())) return false;

  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^## ${escaped}$`, 'm').test(await file.text());
}

/** Does this exact tag already exist? Local `git tag -l`, no network. */
export function tagExists(cwd: string, tag: string): boolean {
  const result = Bun.spawnSync(['git', 'tag', '-l', tag], { cwd });
  return result.stdout.toString().trim() === tag;
}

export type ReleaseDecision = { readonly ok: boolean; readonly reason: string };

export async function shouldRelease(cwd: string, pkg: Pkg): Promise<ReleaseDecision> {
  const tag = `${pkg.name}@${pkg.version}`;

  if (!(await changelogHasEntry(cwd, pkg.version))) {
    return {
      ok: false,
      reason: `CHANGELOG.md has no "## ${pkg.version}" entry — changeset version has not run for this version`,
    };
  }
  if (tagExists(cwd, tag)) {
    return { ok: false, reason: `${tag} already exists — this version was already released` };
  }
  return { ok: true, reason: `CHANGELOG.md has the entry and ${tag} does not exist yet` };
}

/** One ndjson line changesets/action turns into a git tag and a GitHub Release. */
export function tagEvent(pkg: Pkg): { type: 'git-tag'; tag: string; packageName: string } {
  return { type: 'git-tag', tag: `${pkg.name}@${pkg.version}`, packageName: pkg.name };
}

/**
 * App-repo publish-script. Reads `package.json` at `cwd`, gates on `shouldRelease`,
 * and writes the tag event to `$CHANGESETS_OUTPUT` when this version is new.
 *
 * ⛔ `cwd` is the APP, never this package. Defaulting from `import.meta.url` after
 *   publish would inspect `@homeflare/config` itself.
 */
export async function runAppRelease(cwd: string): Promise<ReleaseDecision> {
  const pkg = (await Bun.file(`${cwd}/package.json`).json()) as Pkg;
  const decision = await shouldRelease(cwd, pkg);

  if (!decision.ok) {
    process.stdout.write(`skip: ${decision.reason}\n`);
    return decision;
  }

  const outputFile = process.env['CHANGESETS_OUTPUT'];
  if (outputFile !== undefined) {
    await Bun.write(outputFile, `${JSON.stringify(tagEvent(pkg))}\n`);
  }
  process.stdout.write(
    `${pkg.name}@${pkg.version} — no npm publish; tagged (${decision.reason}).\n`,
  );
  return decision;
}

if (import.meta.main) {
  await runAppRelease(process.cwd());
}
