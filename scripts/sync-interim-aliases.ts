/**
 * Keep every `npm:` alias that points at a workspace package on that package's version.
 *
 * ★ WHY THIS EXISTS. `packages/alchemy` installs the interim distilled SDKs through aliases
 *   such as `"@distilled.cloud/netbox": "npm:@homeflare/distilled-netbox@0.2.0"`. changesets
 *   bumps `@homeflare/distilled-netbox` to 0.3.0 but does not understand an `npm:` alias, so
 *   it leaves the pin at 0.2.0. Inside the workspace bun then stops linking the sibling (the
 *   versions differ) and resolves the old version from the registry instead, and the Version
 *   Packages PR fails `bun install --frozen-lockfile` (measured on kit PR 195, 2026-09-24).
 *   Runs from `bun run version`, after `changeset version`, before the lockfile refresh.
 *
 * ★ DISCOVERED, NOT LISTED, like sync-versions.ts: every workspace package and every dependency
 *   field is scanned, so a new interim package needs no edit here.
 *
 * ★ A string replace, not parse-and-stringify: package.json files are formatted for people,
 *   and re-serialising one would reflow it. Only the exact `"<name>": "npm:<target>@<old>"`
 *   pair is rewritten.
 */
import { Glob } from 'bun';

const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const ALIAS = /^npm:(@?[^@]+)@(.+)$/;

export interface AliasChange {
  readonly field: string;
  readonly name: string;
  readonly target: string;
  readonly from: string;
  readonly to: string;
}

/** The alias rewrites one manifest needs, given every workspace package's version. */
export function aliasChanges(
  manifest: Record<string, unknown>,
  versions: ReadonlyMap<string, string>,
): AliasChange[] {
  const changes: AliasChange[] = [];
  for (const field of FIELDS) {
    const deps = manifest[field];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec !== 'string') continue;
      const match = ALIAS.exec(spec);
      if (!match) continue;
      const [, target, from] = match as unknown as [string, string, string];
      const to = versions.get(target);
      // ⚠️ Only an alias onto a WORKSPACE package moves. An alias onto something published
      //   elsewhere is a real pin somebody chose, and it is not ours to bump.
      if (to !== undefined && to !== from) changes.push({ field, name, target, from, to });
    }
  }
  return changes;
}

/** Apply changes to the manifest's text without reformatting it. */
export function applyChanges(text: string, changes: readonly AliasChange[]): string {
  let out = text;
  for (const c of changes) {
    const before = `"${c.name}": "npm:${c.target}@${c.from}"`;
    const count = out.split(before).length - 1;
    // ⛔ Exactly one occurrence per field entry. Zero or several means the file changed
    //   shape; guessing which to rewrite is worse than stopping the release here.
    if (count !== 1) throw new Error(`expected one ${before}, found ${count}`);
    out = out.replace(before, `"${c.name}": "npm:${c.target}@${c.to}"`);
  }
  return out;
}

async function main(): Promise<void> {
  const root = new URL('..', import.meta.url);
  const rootPkg = await Bun.file(new URL('package.json', root)).json();
  const manifests: URL[] = [];
  for (const pattern of (rootPkg.workspaces ?? []) as string[]) {
    // oxlint-disable-next-line no-await-in-loop
    for await (const relative of new Glob(`${pattern}/package.json`).scan({ cwd: root.pathname })) {
      manifests.push(new URL(relative, root));
    }
  }

  const versions = new Map<string, string>();
  for (const url of manifests) {
    // oxlint-disable-next-line no-await-in-loop
    const m = await Bun.file(url).json();
    if (typeof m.name === 'string' && typeof m.version === 'string')
      versions.set(m.name, m.version);
  }

  let rewritten = 0;
  for (const url of manifests) {
    // oxlint-disable-next-line no-await-in-loop
    const text = await Bun.file(url).text();
    const changes = aliasChanges(JSON.parse(text), versions);
    if (changes.length === 0) continue;
    // oxlint-disable-next-line no-await-in-loop
    await Bun.write(url, applyChanges(text, changes));
    for (const c of changes) {
      console.log(
        `${url.pathname.replace(root.pathname, '')}: ${c.name} -> npm:${c.target}@${c.to} (was ${c.from})`,
      );
    }
    rewritten += changes.length;
  }
  console.log(`sync-interim-aliases: ${rewritten} alias(es) moved`);
}

if (import.meta.main) await main();
