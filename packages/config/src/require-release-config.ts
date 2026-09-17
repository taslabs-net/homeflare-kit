/**
 * Refuse to let `changeset version` run against a config that would silently no-op.
 *
 * 🔴 MEASURED 2026-09-16 on homeflare-openbao, TWO INDEPENDENT WAYS TO GET THE SAME
 *   SILENT FAILURE. `@changesets/cli` 3.0.3 does neither of these things loudly:
 *   1. `package.json` with no "version" — `changeset version` consumes the pending
 *      changeset file, writes no `CHANGELOG.md`, leaves `package.json` untouched.
 *   2. `"private": true` with no `privatePackages.version: true` in
 *      `.changeset/config.json` — the package is excluded from versioning entirely;
 *      `changeset status` reports zero packages to bump even with a real version and a
 *      pending changeset file.
 *   Either gap alone reproduces the same no-op. Both are required together.
 *
 * ★ This is regression protection against either field being dropped — a bad merge, a
 *   hand-edit, a generator overwriting either file — not a bootstrap blocker.
 *
 * 🔴 A leftover `pnpm-workspace.yaml` that lists only nested packages hides the
 *   root. `changeset version` then exits 1 ("package X is not in the workspace") —
 *   measured 2026-09-17 on homeflare-secrets. `problemsFromPendingChangesets`
 *   fails that before the version command consumes the file.
 *
 * ⛔ Path defaults are `process.cwd()`, NEVER `import.meta.url`. After publish this
 *   file lives in `node_modules/@homeflare/config`; resolving next to it would check
 *   the published package, not the app that invoked it.
 */
import { problemsFromPendingChangesets } from './changeset-workspace.ts';

type Pkg = { readonly version?: unknown; readonly private?: unknown };
type ChangesetConfig = { readonly privatePackages?: { readonly version?: unknown } };

export type ReleaseConfigPaths = {
  readonly pkgPath: string;
  readonly changesetConfigPath: string;
};

/** Resolve the two files a version command must see. Override in tests. */
export function releaseConfigPaths(cwd: string = process.cwd()): ReleaseConfigPaths {
  return {
    pkgPath: `${cwd}/package.json`,
    changesetConfigPath: `${cwd}/.changeset/config.json`,
  };
}

/** One thing a project should fix, in the imperative. */
export async function problemsInReleaseConfig(paths: ReleaseConfigPaths): Promise<string[]> {
  const pkg = (await Bun.file(paths.pkgPath).json()) as Pkg;
  const problems: string[] = [];

  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    problems.push(`${paths.pkgPath} has no "version" — changeset version would silently no-op`);
  }

  if (pkg.private === true) {
    const changesetConfig = (await Bun.file(paths.changesetConfigPath).json()) as ChangesetConfig;
    if (changesetConfig.privatePackages?.version !== true) {
      problems.push(
        `${paths.changesetConfigPath} has no privatePackages.version: true — a private package ` +
          'is excluded from versioning entirely, which reads as "nothing to release"',
      );
    }
  }

  const cwd = paths.pkgPath.replace(/\/package\.json$/, '');
  problems.push(...(await problemsFromPendingChangesets(cwd)));

  return problems;
}

/** Print and exit. App `version` scripts call this before `changeset version`. */
export async function runRequireReleaseConfig(paths?: Partial<ReleaseConfigPaths>): Promise<void> {
  // ⚠️ A spread of `{ pkgPath: undefined }` from `process.argv[2]` would overwrite the
  //   cwd default. Only copy keys that are actually present.
  const defaults = releaseConfigPaths();
  const resolved: ReleaseConfigPaths = {
    pkgPath: paths?.pkgPath ?? defaults.pkgPath,
    changesetConfigPath: paths?.changesetConfigPath ?? defaults.changesetConfigPath,
  };
  const problems = await problemsInReleaseConfig(resolved);

  if (problems.length > 0) {
    process.stderr.write('\n✗ changeset version would silently no-op:\n');
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.stderr.write('\n  Fix the file(s) above in a reviewed commit, then re-run this.\n\n');
    process.exit(1);
  }

  const pkg = (await Bun.file(resolved.pkgPath).json()) as Pkg;
  process.stdout.write(
    `ok: ${resolved.pkgPath} version is ${pkg.version}, privatePackages.version is set\n`,
  );
}

if (import.meta.main) {
  const pkgPath = process.argv[2];
  const changesetConfigPath = process.argv[3];
  await runRequireReleaseConfig({
    ...(pkgPath === undefined ? {} : { pkgPath }),
    ...(changesetConfigPath === undefined ? {} : { changesetConfigPath }),
  });
}
