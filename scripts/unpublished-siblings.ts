/**
 * Let a consumer smoke test install a release set whose members are not on npm yet.
 *
 * 🔴 WHY THIS EXISTS. `packages/alchemy` depends on its interim distilled SDKs through aliases
 *   (`"@distilled.cloud/netbox": "npm:@homeflare/distilled-netbox@0.3.0"`). The Version Packages
 *   PR bumps both in one go, so its smoke test packs an alchemy that needs
 *   `@homeflare/distilled-netbox@0.3.0` — which only reaches npm when that same release
 *   publishes. `bun add` of the tarball then fails "No version matching …" (kit PR 195,
 *   2026-09-24). bun's `overrides` do not reach an `npm:` alias (measured the same day, keyed
 *   both by the alias and by the target), so the smoke copy's alias is rewritten instead.
 *
 * ⛔ ONLY THE SMOKE TARBALL IS EDITED, never the published one: each swap packs the sibling from
 *   the workspace and points the smoke copy's alias at that tarball with `file:`. The imports the
 *   smoke test then runs are the same ones a consumer runs once the release has published.
 * ⛔ Only an alias onto a WORKSPACE package whose exact version npm answers 404 for is swapped.
 *   Anything already published installs from the registry exactly as a consumer's would.
 */
import { Glob } from 'bun';
import { editPackedManifest, packForPublish } from './pack.ts';

const FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;
const ALIAS = /^npm:(@?[^@]+)@(.+)$/;

export interface AliasOntoWorkspace {
  readonly field: string;
  readonly name: string;
  readonly target: string;
  readonly version: string;
}

export interface SiblingSwap extends AliasOntoWorkspace {
  readonly tarball: string;
}

/** Every `npm:` alias in a manifest whose target is a package in this workspace. */
export function aliasesOntoWorkspace(
  manifest: Record<string, unknown>,
  workspace: ReadonlyMap<string, string>,
): AliasOntoWorkspace[] {
  const out: AliasOntoWorkspace[] = [];
  for (const field of FIELDS) {
    const deps = manifest[field];
    if (typeof deps !== 'object' || deps === null) continue;
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      const match = typeof spec === 'string' ? ALIAS.exec(spec) : null;
      if (match?.[1] && match[2] && workspace.has(match[1])) {
        out.push({ field, name, target: match[1], version: match[2] });
      }
    }
  }
  return out;
}

/**
 * Whether npm serves this exact version. 200 is yes, 404 is no, and anything else throws:
 * ⛔ a registry outage must fail the smoke test, never read as "unpublished" and quietly
 *   swap in a local tarball.
 */
export async function isPublished(
  name: string,
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const url = `https://registry.npmjs.org/${name.replaceAll('/', '%2f')}/${encodeURIComponent(version)}`;
  const res = await fetchImpl(url, { method: 'GET' });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`npm registry answered ${res.status} for ${name}@${version}`);
}

/** Map each workspace package name to its directory, from the root `workspaces` globs. */
async function workspacePackages(repoRoot: string): Promise<Map<string, string>> {
  const rootPkg = JSON.parse(await Bun.file(`${repoRoot}/package.json`).text());
  const map = new Map<string, string>();
  for (const pattern of (rootPkg.workspaces ?? []) as string[]) {
    // oxlint-disable-next-line no-await-in-loop
    for await (const rel of new Glob(`${pattern}/package.json`).scan({ cwd: repoRoot })) {
      // oxlint-disable-next-line no-await-in-loop
      const m = JSON.parse(await Bun.file(`${repoRoot}/${rel}`).text());
      if (typeof m.name === 'string')
        map.set(m.name, `${repoRoot}/${rel.replace(/package\.json$/, '')}`);
    }
  }
  return map;
}

/**
 * Point every alias in the smoke tarball whose target version is not on npm at a freshly packed
 * tarball of the workspace sibling. Returns what was swapped, so the caller can say so loudly.
 */
export async function swapUnpublishedSiblings(
  tarball: string,
  scratch: string,
  repoRoot: string,
): Promise<SiblingSwap[]> {
  const workspace = await workspacePackages(repoRoot);
  const swaps: SiblingSwap[] = [];
  await editPackedManifest(tarball, async (manifest) => {
    for (const alias of aliasesOntoWorkspace(manifest, workspace)) {
      // oxlint-disable-next-line no-await-in-loop
      if (await isPublished(alias.target, alias.version)) continue;
      const dir = workspace.get(alias.target) ?? '';
      // oxlint-disable-next-line no-await-in-loop
      const sibling = await packForPublish(dir, scratch);
      (manifest[alias.field] as Record<string, string>)[alias.name] = `file:${sibling}`;
      swaps.push({ ...alias, tarball: sibling });
    }
  });
  return swaps;
}
