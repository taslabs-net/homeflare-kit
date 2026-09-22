/**
 * The committed coverage report is the repository's claim about which vendor endpoints our
 * Proxmox Resources write to. These tests hold that claim to the schema it was generated from.
 *
 * ⛔ NOTHING HERE READS THE RAW VENDOR SCHEMAS. They are 5.7 MB of vendor documentation that is
 *   deliberately not in git (schemas/README.md), and CI has no cache directory. The committed
 *   `docs/api-coverage.json` IS the schema's write surface, distilled — so these tests check the
 *   ledger against it and check that it is not stale, which is everything CI can honestly verify.
 *
 * ★ THE FAILURE THIS IS FOR. `deploy:pbs` adopted ten objects and failed its one create on a
 *   vendor `maxLength` nothing in plan, check or tests knew about. A report that silently rots is
 *   worth no more than the hand-written gap list it replaces, so every way it can rot fails here.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Coverage, Row } from '../scripts/api-coverage-model.ts';
import { formatAs } from '../scripts/api-coverage-format.ts';
import { renderMarkdown } from '../scripts/api-coverage-render.ts';
import type { Manifest } from '../scripts/api-schema.ts';
import { short } from '../scripts/api-schema.ts';
import { OWNERSHIP } from '../scripts/proxmox-ownership.ts';

const root = dirname(import.meta.dir);
const REFRESH = 'bun run api:coverage';

const coverage = JSON.parse(
  readFileSync(join(root, 'docs', 'api-coverage.json'), 'utf8'),
) as Coverage;
const manifest = JSON.parse(
  readFileSync(join(root, 'schemas', 'manifest.json'), 'utf8'),
) as Manifest;

const rowsFor = (system: string): readonly Row[] =>
  coverage.systems.find((s) => s.system === system)?.rows ?? [];

/** Every write endpoint the schema has, as `METHOD /path`, per system. */
const present = new Map<string, Set<string>>(
  coverage.systems.map((s) => [s.system, new Set(s.rows.map((r) => `${r.method} ${r.path}`))]),
);

const has = (system: string, call: string): boolean => present.get(system)?.has(call) === true;

describe('the ledger claims only endpoints the schema has', () => {
  for (const o of OWNERSHIP) {
    test(`${o.resource} writes exist in the ${o.system.toUpperCase()} schema`, () => {
      const missing = o.writes
        .map((w) => `${w.method} ${w.path}`)
        .filter((call) => !has(o.system, call));
      expect(
        missing,
        `${o.resource} (${o.file}) claims ${missing.join(', ')}, which the vendor schema in ` +
          `schemas/manifest.json does not have. Either the path is wrong, or the vendor removed ` +
          `it — fix ${o.file} and the ledger, then rerun \`${REFRESH}\`.`,
      ).toEqual([]);
    });
  }
});

describe('paths the source calls unreachable really are absent', () => {
  for (const o of OWNERSHIP) {
    const notes = [...(o.refuted ?? []), ...(o.broken ?? [])];
    if (notes.length === 0) continue;
    test(`${o.resource}`, () => {
      const nowPresent = notes
        .map((n) => `${n.method} ${n.path}`)
        .filter((call) => has(o.system, call));
      expect(
        nowPresent,
        `${o.resource} (${o.file}) is documented as unable to use ${nowPresent.join(', ')}, but ` +
          `the vendor now implements it. The comment at the code is stale — read it, decide, and ` +
          `move the entry into \`writes\`.`,
      ).toEqual([]);
    });
  }
});

describe('the report and the ledger agree', () => {
  test('every owner named in the report is a Resource in the ledger', () => {
    const known = new Set(OWNERSHIP.map((o) => o.resource));
    const unknown = new Set<string>();
    for (const s of coverage.systems) {
      for (const r of s.rows) {
        for (const owner of r.owner?.split(', ') ?? []) if (!known.has(owner)) unknown.add(owner);
      }
    }
    expect([...unknown], `stale owners in docs/api-coverage.json — rerun \`${REFRESH}\``).toEqual(
      [],
    );
  });

  test('every ledger Resource owns at least one endpoint in the report', () => {
    const owned = new Set(
      coverage.systems.flatMap((s) => s.rows.flatMap((r) => r.owner?.split(', ') ?? [])),
    );
    const orphans = OWNERSHIP.filter((o) => !owned.has(o.resource)).map((o) => o.resource);
    expect(orphans, `these own nothing in the report — rerun \`${REFRESH}\``).toEqual([]);
  });

  /**
   * ⛔ BOTH DIRECTIONS, AND THE SECOND ONE IS THE IMPORTANT HALF. Checking only ledger → source
   *   catches a deleted family; it does NOT catch a family that landed and was never added to the
   *   ledger, which is the drift that actually happens. A missing row makes the report understate
   *   coverage silently, and no other test here can see it — this one can.
   */
  test('the ledger and the package declare exactly the same Resource kinds', () => {
    const dir = join(root, 'packages', 'alchemy', 'src', 'proxmox');
    const kinds = new Set<string>();
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue;
      for (const m of readFileSync(join(dir, name), 'utf8').matchAll(
        /\bResource<[^>]+>\(\s*'([^']+)'/g,
      )) {
        if (m[1] !== undefined) kinds.add(m[1]);
      }
    }
    const declared = new Set(OWNERSHIP.map((o) => o.resource));
    expect(
      OWNERSHIP.filter((o) => !kinds.has(o.resource)).map((o) => o.resource),
      'the ledger names Resources the package no longer declares; delete their rows in ' +
        'scripts/proxmox-ownership-*.ts',
    ).toEqual([]);
    expect(
      [...kinds].filter((k) => !declared.has(k)).sort(),
      'these Proxmox Resources write to the cluster and no ledger row says where. Add them to ' +
        `scripts/proxmox-ownership-*.ts and rerun \`${REFRESH}\`.`,
    ).toEqual([]);
  });

  test('the recorded defects are still listed as defects', () => {
    const declared = OWNERSHIP.flatMap((o) =>
      (o.broken ?? []).map((b) => `${o.resource} ${b.method} ${b.path}`),
    ).sort();
    const reported = coverage.broken.map((b) => `${b.resource} ${b.method} ${b.path}`).sort();
    expect(reported, `docs/api-coverage.json is out of step — rerun \`${REFRESH}\``).toEqual(
      declared,
    );
  });
});

describe('the report is not stale', () => {
  test('each system names the manifest version and hash it was generated from', () => {
    for (const s of coverage.systems) {
      const e = manifest.entries.find((m) => m.id === `proxmox/${s.system}`);
      expect(e, `schemas/manifest.json lost its proxmox/${s.system} entry`).toBeDefined();
      expect(
        [s.version, s.sha256Short],
        `docs/api-coverage.json was generated from ${s.version} (${s.sha256Short}…) and the ` +
          `manifest now says ${e?.version ?? '?'} (${short(e?.sha256 ?? '')}…). Refresh it: ` +
          `${REFRESH}`,
      ).toEqual([e?.version ?? '', short(e?.sha256 ?? '')]);
    }
  });

  test('the generator version matches the manifest', () => {
    expect(coverage.generator, `rerun \`${REFRESH}\``).toEqual(manifest.generator);
  });

  test('the markdown is what the JSON renders to, byte for byte', async () => {
    const committed = readFileSync(join(root, 'docs', 'api-coverage.md'), 'utf8');
    expect(
      await formatAs(root, renderMarkdown(coverage), 'api-coverage.md'),
      `docs/api-coverage.md does not match docs/api-coverage.json. It is generated — never edit ` +
        `it by hand. Refresh both: ${REFRESH}`,
    ).toEqual(committed);
  });

  test('the report covers both products and only write methods', () => {
    expect(coverage.systems.map((s) => s.system)).toEqual(['pve', 'pbs']);
    for (const system of ['pve', 'pbs']) {
      const rows = rowsFor(system);
      expect(rows.length, `${system} has no rows — rerun \`${REFRESH}\``).toBeGreaterThan(0);
      expect(rows.filter((r) => r.method === 'GET')).toEqual([]);
    }
  });

  test('every manifest entry with no output is reported as available, not adopted', () => {
    const unused = manifest.entries.filter((e) => !e.id.startsWith('proxmox/')).map((e) => e.id);
    expect(coverage.availableUnused.map((u) => u.id).sort()).toEqual(unused.sort());
  });
});
