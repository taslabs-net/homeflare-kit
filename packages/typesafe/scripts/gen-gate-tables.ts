/**
 * Regenerates packages/typesafe/src/gate/generated/*.ts from the vendor sources named
 * below — gitleaks' own rule config and the two IANA special-purpose registries — never
 * from a hand-typed rule. See gen-gate-tables-rules.ts for the regex dialect translation,
 * gen-gate-tables-ranges.ts for the IANA CSV parse, and gen-gate-tables-render.ts for
 * turning both into file text; this file only fetches/verifies, classifies and writes
 * (or, under `--check`, compares without writing).
 *
 * ⛔ PROVENANCE IS KEPT PACKAGE-LOCAL, DELIBERATELY NOT IN THE SHARED
 *   codegen/manifest.json — other waves edit that file concurrently; SOURCES below is
 *   this generator's own table, same shape and same cache directory convention as
 *   codegen/schema-cache.ts (codegen/README.md), just not registered there.
 *
 * Commands:
 *   bun packages/typesafe/scripts/gen-gate-tables.ts            # verify, regenerate, write
 *   bun packages/typesafe/scripts/gen-gate-tables.ts --check    # compare, exit non-zero if stale
 *
 * Re-fetching (read-only, no credential):
 *   gh api 'repos/gitleaks/gitleaks/contents/config/gitleaks.toml?ref=v8.30.1' \
 *     --jq '.content' | base64 -d > "$HOMEFLARE_SCHEMA_CACHE/typesafe-gate/gitleaks-v8.30.1.toml"
 *   curl -sL https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv \
 *     -o "$HOMEFLARE_SCHEMA_CACHE/typesafe-gate/iana-ipv4-special-registry-1.csv"
 *   curl -sL https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv \
 *     -o "$HOMEFLARE_SCHEMA_CACHE/typesafe-gate/iana-ipv6-special-registry-1.csv"
 * Then update this file's SOURCES entry (sha256, bytes, fetchedAt) and rerun.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseIanaCsv } from './gen-gate-tables-ranges.ts';
import {
  type RenderSource,
  renderDropped,
  renderEmitted,
  renderRanges,
  renderRulesIndex,
} from './gen-gate-tables-render.ts';
import { type GitleaksRaw, classifyRules } from './gen-gate-tables-rules.ts';

interface Source extends RenderSource {
  readonly file: string;
}

// Measured 2026-09-23 — see the fetch commands above. A near-miss sha256 is a
// different file, not a rounding error: readVerified() below refuses to proceed on one.
const GITLEAKS_SOURCE: Source = {
  sourceUrl: 'https://raw.githubusercontent.com/gitleaks/gitleaks/v8.30.1/config/gitleaks.toml',
  file: 'gitleaks-v8.30.1.toml',
  sha256: 'e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf',
  bytes: 97731,
  fetchedAt: '2026-09-23T00:00:00Z',
  license: 'MIT',
};
const IANA_IPV4_SOURCE: Source = {
  sourceUrl:
    'https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv',
  file: 'iana-ipv4-special-registry-1.csv',
  sha256: 'e3e39e76d00b1677335db8e9a805c7b9480ea2f4dc9e33f0b93cd3a905128d73',
  bytes: 2423,
  fetchedAt: '2026-09-23T00:00:00Z',
  license: 'public domain (IANA registry)',
};
const IANA_IPV6_SOURCE: Source = {
  sourceUrl:
    'https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv',
  file: 'iana-ipv6-special-registry-1.csv',
  sha256: '775feea0621dec8735a44fbf30f762e721e8f0a1b3ab7eb341961a88cfce2139',
  bytes: 2289,
  fetchedAt: '2026-09-23T00:00:00Z',
  license: 'public domain (IANA registry)',
};
const SOURCES: readonly Source[] = [GITLEAKS_SOURCE, IANA_IPV4_SOURCE, IANA_IPV6_SOURCE];

function cacheDir(): string {
  const base =
    process.env['HOMEFLARE_SCHEMA_CACHE'] ?? join(homedir(), '.cache', 'homeflare', 'schemas');
  return join(base.replace(/^~/, homedir()), 'typesafe-gate');
}

async function readVerified(source: Source): Promise<string | undefined> {
  const path = join(cacheDir(), source.file);
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  const bytes = await file.arrayBuffer();
  const sha = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  if (sha !== source.sha256 || bytes.byteLength !== source.bytes) {
    throw new Error(
      `${source.file}: ${path} is sha256 ${sha.slice(0, 16)}… / ${bytes.byteLength} bytes, this ` +
        `generator expects ${source.sha256.slice(0, 16)}… / ${source.bytes}. Re-fetch (see this ` +
        "file's header) or update its source entry with the new sha256/bytes/fetchedAt.",
    );
  }
  return new TextDecoder().decode(bytes);
}

const GENERATED_DIR = new URL('../src/gate/generated/', import.meta.url);

export async function digestOf(emitted: unknown, dropped: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ emitted, dropped }));
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');

  const texts = await Promise.all(SOURCES.map(readVerified));
  if (texts.some((t) => t === undefined)) {
    console.log(
      "gen-gate-tables: schema cache is missing one or more sources (see this file's header to " +
        `re-fetch) — looked in ${cacheDir()}. Skipping${check ? ' (--check)' : ''}.`,
    );
    process.exit(0);
  }
  const [gitleaksText, ipv4Text, ipv6Text] = texts as [string, string, string];

  const toml = Bun.TOML.parse(gitleaksText) as { rules: GitleaksRaw[] };
  const { emitted, dropped, regexRuleCount } = classifyRules(toml.rules);
  if (regexRuleCount !== 221) {
    throw new Error(
      `gitleaks config now has ${regexRuleCount} rules with a regex, expected 221 — re-measure, do not just bump this number`,
    );
  }
  const digest = await digestOf(emitted, dropped);

  const v4 = parseIanaCsv(ipv4Text, 4);
  const v6 = parseIanaCsv(ipv6Text, 6);

  const files: Record<string, string> = {
    'gitleaks-rules.ts': renderRulesIndex(GITLEAKS_SOURCE, digest),
    'gitleaks-rules-emitted.ts': renderEmitted(GITLEAKS_SOURCE, emitted),
    'gitleaks-rules-dropped.ts': renderDropped(GITLEAKS_SOURCE, dropped),
    'special-ranges.ts': renderRanges(IANA_IPV4_SOURCE, IANA_IPV6_SOURCE, v4, v6),
  };

  let stale = false;
  for (const [name, content] of Object.entries(files)) {
    const path = new URL(name, GENERATED_DIR);
    const current = (await Bun.file(path).exists()) ? await Bun.file(path).text() : undefined;
    if (check) {
      if (current !== content) {
        console.log(`gen-gate-tables --check: ${name} is stale`);
        stale = true;
      }
      continue;
    }
    if (current !== content) {
      await Bun.write(path, content);
      console.log(`gen-gate-tables: wrote ${name}`);
    }
  }

  if (check && stale) {
    console.log(
      'gen-gate-tables --check: run `bun packages/typesafe/scripts/gen-gate-tables.ts` to refresh.',
    );
    process.exit(1);
  }
  console.log(
    `gen-gate-tables: ${emitted.length} rules emitted, ${dropped.length} dropped, ${v4.length + v6.length} address ranges.`,
  );
}

if (import.meta.main) await main();
