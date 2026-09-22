/**
 * Regenerate `docs/api-coverage.{md,json}` from the vendor schemas, or check the committed ones.
 *
 *   bun run api:coverage            # re-read the cache, verify sha256, rewrite both files
 *   bun run api:coverage --check    # same, but write nothing and report the diff
 *
 * ⛔ THE COMMITTED FILES ARE THE ONLY OUTPUT ANYONE READS, AND THEY ARE NEVER HAND-EDITED. A
 *   correction goes in the ledger (`scripts/proxmox-ownership*.ts`) or the manifest, never in the
 *   report. `tests/api-coverage.test.ts` holds that line without needing the raw schemas, which CI
 *   does not have.
 *
 * ★ THE GENERATOR IS VERSIONED BY HAND, not by git commit. Embedding the commit would make every
 *   commit stale the output and the staleness test would fire on work it knows nothing about.
 *   Bump `generator.version` in `schemas/manifest.json` when the output format changes.
 */
import { dirname, join } from 'node:path';
import { formatAs } from './api-coverage-format.ts';
import { buildCoverage } from './api-coverage-model.ts';
import { renderMarkdown } from './api-coverage-render.ts';
import { endpoints, entry, parseApidoc, readCached, readManifest } from './api-schema.ts';

const repoRoot = dirname(import.meta.dir);

export const generate = async (): Promise<{ markdown: string; json: string }> => {
  const manifest = await readManifest(repoRoot);
  const pve = endpoints(parseApidoc(await readCached(entry(manifest, 'proxmox/pve'))));
  const pbs = endpoints(parseApidoc(await readCached(entry(manifest, 'proxmox/pbs'))));
  const coverage = buildCoverage(manifest, { pbs, pve });
  return {
    json: await formatAs(repoRoot, `${JSON.stringify(coverage, null, 2)}\n`, 'api-coverage.json'),
    markdown: await formatAs(repoRoot, renderMarkdown(coverage), 'api-coverage.md'),
  };
};

const REFRESH = 'bun run api:coverage';

const main = async (): Promise<void> => {
  const check = process.argv.includes('--check');
  const { markdown, json } = await generate();
  const targets = [
    { name: 'docs/api-coverage.md', next: markdown },
    { name: 'docs/api-coverage.json', next: json },
  ];

  const stale: string[] = [];
  for (const t of targets) {
    const path = join(repoRoot, t.name);
    const file = Bun.file(path);
    const current = (await file.exists()) ? await file.text() : null;
    if (current === t.next) continue;
    if (check) {
      stale.push(current === null ? `${t.name} is missing` : `${t.name} is out of date`);
      continue;
    }
    await Bun.write(path, t.next);
    console.log(`wrote ${t.name}`);
  }

  if (check && stale.length > 0) {
    console.error(`${stale.join('\n')}\n\nRefresh it: ${REFRESH}`);
    process.exit(1);
  }
  if (check) console.log('docs/api-coverage.{md,json} match the schemas in schemas/manifest.json');
};

if (import.meta.main) await main();
