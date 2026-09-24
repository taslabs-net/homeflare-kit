/**
 * Build every distilled interim package this workspace's own manifests actually alias, in a
 * fixed, sequential, root-level order.
 *
 * ★ WHY SEQUENTIAL AND ROOT-LEVEL, NOT `bun run --filter '*' build`. `tsc` (unlike bun's own
 *   runtime resolver) needs each aliased interim package's `dist/` built and its `exports`
 *   map resolvable BEFORE the filtered fan-out starts, or CI hits a genuine, intermittent
 *   race (kit PR #193: a `pretypes`-per-package hook passed locally every time and failed
 *   real CI on the identical commit, under `bun run --filter '*' types`'s parallel fan-out).
 *   Root-level `build`/`types` run this ONE script first, before any `--filter '*'` step
 *   starts at all — that is what removes the concurrency rather than trying to win it. This
 *   script keeps that shape: one process, one package built after another.
 *
 * ★ DISCOVERED, NOT LISTED, like scripts/sync-versions.ts and scripts/sync-interim-aliases.ts:
 *   every workspace package.json's `dependencies` is scanned for a
 *   `"@distilled.cloud/<vendor>": "npm:@homeflare/distilled-<vendor>@<version>"` alias — the
 *   exact shape docs/distilled-interim.md's step 5 installs — and only the aliased vendors are
 *   built. A new consuming PR that adds an alias needs no edit here; a `packages/distilled-*`
 *   package nobody has aliased yet (distilled-opnsense, distilled-unifi-network, as of
 *   2026-09-24) is skipped, and starts building the moment some package's `dependencies` names
 *   it — no hand list to fall out of sync, and no merge conflict when two vendor PRs land the
 *   same night (this replaced a two-name hard-coded list that already needed an edit per PR).
 */
import { Glob } from 'bun';
import { spawnSync } from 'node:child_process';

const ALIAS = /^npm:@homeflare\/(distilled-[\w-]+)@/;

/** The `packages/*` directory names every aliased interim SDK lives in, sorted for stability. */
export async function aliasedInterimPackages(root: URL): Promise<string[]> {
  const found = new Set<string>();
  for await (const relative of new Glob('packages/*/package.json').scan({ cwd: root.pathname })) {
    // oxlint-disable-next-line no-await-in-loop
    const manifest = await Bun.file(new URL(relative, root)).json();
    const deps = manifest.dependencies;
    if (typeof deps !== 'object' || deps === null) continue;
    for (const spec of Object.values(deps as Record<string, unknown>)) {
      if (typeof spec !== 'string') continue;
      const match = ALIAS.exec(spec);
      if (match) found.add(match[1] as string);
    }
  }
  return [...found].sort();
}

async function main(): Promise<void> {
  const root = new URL('../', import.meta.url);
  const names = await aliasedInterimPackages(root);
  for (const name of names) {
    console.log(`build:interim-packages: building ${name}`);
    const result = spawnSync('bun', ['run', 'build'], {
      cwd: new URL(`packages/${name}/`, root).pathname,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error(`build:interim-packages: ${name} exited ${String(result.status)}`);
    }
  }
}

if (import.meta.main) await main();
