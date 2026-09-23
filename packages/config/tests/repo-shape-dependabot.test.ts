/**
 * `.github/dependabot.yml`'s bun block, and its `ignore` for `@homeflare/*`.
 *
 * ⛔ PARSED, NOT GREPPED — a substring can be present in a file Dependabot refuses to load.
 *
 * ★ RETIRED HERE (2026-09-23, kit auto-bumper design, Tim): the `homeflare` group
 *   and the rendered `dependabot-automerge.yml` that arm-merged it. `homeflare-bumper`
 *   carries kit releases into a consumer now; this file only has to prove Dependabot gets
 *   out of its way.
 */
import { describe, expect, test } from 'bun:test';
import {
  HOMEFLARE_PATTERN,
  RENDERED_PATHS,
  type RepoShape,
  THIRD_PARTY_COOLDOWN_DAYS,
  renderRepoShape,
} from '../src/repo-shape.ts';

const MINI: RepoShape = {
  owner: 'taslabs-net',
  publishes: false,
  repository: 'homeflare-mini',
  runner: 'mini',
};
const KIT: RepoShape = { ...MINI, publishes: true, repository: 'homeflare-kit', runner: 'github' };

type Group = { patterns: string[]; 'update-types'?: string[] };
type Update = {
  'package-ecosystem': string;
  directories?: string[];
  directory?: string;
  schedule: { interval: string };
  cooldown?: { 'default-days': number; exclude?: string[] };
  ignore?: { 'dependency-name': string }[];
  groups: Record<string, Group>;
};

function updates(shape: RepoShape): Update[] {
  const text = renderRepoShape(shape).files['.github/dependabot.yml'] ?? '';
  return (Bun.YAML.parse(text) as { updates: Update[] }).updates;
}

function bun(shape: RepoShape): Update {
  const blocks = updates(shape).filter((u) => u['package-ecosystem'] === 'bun');
  // ⛔ EXACTLY ONE. Dependabot refuses two blocks for one ecosystem whose directories
  //   overlap, which is why third-party and the workflow-refresh drift share one block.
  expect(blocks).toHaveLength(1);
  return blocks[0] as Update;
}

describe('the bun block ignores @homeflare/*, which the bumper now owns', () => {
  test('an ignore entry names the whole scope, not a group', () => {
    const block = bun(MINI);
    expect(block.ignore).toEqual([{ 'dependency-name': HOMEFLARE_PATTERN }]);
    expect(block.groups['homeflare']).toBeUndefined();
  });

  test('the cooldown carries no exclude — there is nothing left to exempt', () => {
    // ⛔ The `exclude` this cooldown used to carry existed only to let a homeflare-group
    //   bump skip Dependabot's own 3-day default. An ignored dependency never reaches the
    //   cooldown check at all, so exempting it from cooldown is no longer meaningful.
    const cooldown = bun(MINI).cooldown;
    expect(cooldown?.exclude).toBeUndefined();
    expect(cooldown?.['default-days']).toBe(THIRD_PARTY_COOLDOWN_DAYS);
  });

  test('lint-and-format and build-tooling remain, first-party gone', () => {
    const groups = Object.keys(bun(MINI).groups);
    expect(groups).toEqual(['lint-and-format', 'build-tooling']);
  });

  test('every remaining group identifier is one Dependabot accepts', () => {
    // Dependabot: "must start and end with a letter"; letters, `|`, `_` and `-` between.
    for (const name of Object.keys(bun(MINI).groups)) {
      expect(name).toMatch(/^[A-Za-z](?:[A-Za-z|_-]*[A-Za-z])?$/);
    }
  });

  test('bun is weekly now, same as the Actions block — nothing needs it daily any more', () => {
    // ★ The block only ran daily to catch a kit release fast; the bumper's own dispatch
    //   and 6-hourly schedule do that job now, over a channel Dependabot never sees.
    expect(bun(MINI).schedule.interval).toBe('weekly');
    const actions = updates(MINI).find((u) => u['package-ecosystem'] === 'github-actions');
    expect(actions?.schedule.interval).toBe('weekly');
  });

  test('a publisher still watches every workspace package.json', () => {
    expect(bun(MINI).directories).toEqual(['/']);
    expect(bun(KIT).directories).toEqual(['/', '/packages/*']);
  });

  test('dependabot-automerge.yml is gone — nothing renders it any more', () => {
    expect(RENDERED_PATHS).not.toContain('.github/workflows/dependabot-automerge.yml');
    expect(
      renderRepoShape(MINI).files['.github/workflows/dependabot-automerge.yml'],
    ).toBeUndefined();
  });
});
