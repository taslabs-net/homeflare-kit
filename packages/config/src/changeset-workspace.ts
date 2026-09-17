/**
 * Pending changesets must name a package Changesets actually considers a workspace
 * member. Otherwise `changeset version` exits 1 and no Version Packages PR opens.
 *
 * 🔴 MEASURED 2026-09-17 on homeflare-secrets. A leftover `pnpm-workspace.yaml`
 *   listed only `hfs` and `secret-vault`. `@changesets/cli` treats that file as the
 *   workspace, so the root package (`homeflare-secrets` — the GitHub Release) was
 *   "not in the workspace". The hygiene changeset named the root. Release on main
 *   failed; no Version PR, no tag.
 *
 * ★ Root is a member only when the workspace file says so (`.` or a package.json
 *   `workspaces` entry). Nested leftover packages keep their own package.json for
 *   their own tools; they are not this repo's release.
 */
import { readdir } from 'node:fs/promises';

type WorkspaceFile = { readonly packages?: readonly string[] };
type RootPkg = {
  readonly name?: unknown;
  readonly workspaces?: readonly string[];
};

function rootName(pkg: RootPkg): readonly string[] {
  return typeof pkg.name === 'string' ? [pkg.name] : [];
}

export async function workspacePackageNames(cwd: string): Promise<readonly string[]> {
  const pnpm = Bun.file(`${cwd}/pnpm-workspace.yaml`);
  if (await pnpm.exists()) {
    const parsed = Bun.YAML.parse(await pnpm.text()) as WorkspaceFile;
    return namesFromPatterns(cwd, parsed.packages ?? []);
  }

  const pkg = (await Bun.file(`${cwd}/package.json`).json()) as RootPkg;
  // ★ Array form only. The yarn `{ packages: [] }` object is unused in this estate,
  //   and `Array.isArray` does not narrow that union under exactOptionalPropertyTypes.
  if (pkg.workspaces !== undefined && pkg.workspaces.length > 0) {
    return namesFromPatterns(cwd, pkg.workspaces);
  }
  return rootName(pkg);
}

async function namesFromPatterns(cwd: string, patterns: readonly string[]): Promise<string[]> {
  const names: string[] = [];
  for (const pattern of patterns) {
    // ⛔ Full glob support is not the job. Changesets already expands globs; this
    //   guard only needs `.` and literal directory members — the case that hid
    //   the root. A `*` pattern is skipped rather than half-parsed.
    if (pattern.includes('*')) continue;
    const pkgPath = pattern === '.' ? `${cwd}/package.json` : `${cwd}/${pattern}/package.json`;
    const file = Bun.file(pkgPath);
    if (!(await file.exists())) continue;
    const name = ((await file.json()) as { readonly name?: unknown }).name;
    if (typeof name === 'string') names.push(name);
  }
  return names;
}

/** Package names in a changeset file's YAML frontmatter. */
export function packagesNamedInChangeset(text: string): readonly string[] {
  const match = /^---\n([\s\S]*?)\n---/m.exec(text);
  if (match?.[1] === undefined) return [];
  const parsed = Bun.YAML.parse(match[1]);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  return Object.keys(parsed);
}

export async function problemsFromPendingChangesets(cwd: string): Promise<readonly string[]> {
  let files: string[];
  try {
    files = (await readdir(`${cwd}/.changeset`)).filter(
      (name) => name.endsWith('.md') && name !== 'README.md',
    );
  } catch {
    // Missing `.changeset` is not a fault — nothing pending.
    return [];
  }
  if (files.length === 0) return [];

  const workspace = new Set(await workspacePackageNames(cwd));
  const problems: string[] = [];
  for (const name of files) {
    const rel = `.changeset/${name}`;
    for (const pkg of packagesNamedInChangeset(await Bun.file(`${cwd}/${rel}`).text())) {
      if (!workspace.has(pkg)) {
        problems.push(
          `${rel} names "${pkg}" which is not in the workspace — changeset version ` +
            'exits 1 (measured 2026-09-17: leftover pnpm-workspace.yaml listed nested ' +
            'packages and hid the root)',
        );
      }
    }
  }
  return problems;
}
