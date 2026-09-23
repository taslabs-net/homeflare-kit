/**
 * The `homeflare` group and the workflow that arms auto-merge on it.
 *
 * ⛔ PARSED, NOT GREPPED — the same rule as `repo-shape-render.test.ts`. A substring can be
 *   present in a file Dependabot or GitHub refuses to load.
 */
import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GROUP_BRANCH,
  GROUP_BRANCH_PREFIX,
  HOMEFLARE_GROUP,
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
  groups: Record<string, Group>;
};

function updates(shape: RepoShape): Update[] {
  const text = renderRepoShape(shape).files['.github/dependabot.yml'] ?? '';
  return (Bun.YAML.parse(text) as { updates: Update[] }).updates;
}

function bun(shape: RepoShape): Update {
  const blocks = updates(shape).filter((u) => u['package-ecosystem'] === 'bun');
  // ⛔ EXACTLY ONE. Dependabot refuses two blocks for one ecosystem whose directories
  //   overlap, which is why the group's schedule is the whole block's schedule.
  expect(blocks).toHaveLength(1);
  return blocks[0] as Update;
}

type Job = {
  if: string;
  'runs-on': unknown;
  permissions: Record<string, string>;
  steps: { uses?: string; run?: string; env?: Record<string, string> }[];
};

function automerge(shape: RepoShape): { permissions: unknown; jobs: Record<string, Job> } {
  const text = renderRepoShape(shape).files['.github/workflows/dependabot-automerge.yml'] ?? '';
  return Bun.YAML.parse(text) as { permissions: unknown; jobs: Record<string, Job> };
}

describe('the bun block carries kit releases daily', () => {
  test('daily, with the homeflare group first and taking every update type', () => {
    const block = bun(MINI);
    expect(block.schedule.interval).toBe('daily');
    expect(Object.keys(block.groups)[0]).toBe(HOMEFLARE_GROUP);
    // ★ No `update-types`: a kit release is one set of packages, majors included.
    expect(block.groups[HOMEFLARE_GROUP]).toEqual({ patterns: [HOMEFLARE_PATTERN] });
  });

  test('first-party skips the cooldown Dependabot applies even when none is set', () => {
    const cooldown = bun(MINI).cooldown;
    expect(cooldown?.exclude).toEqual([HOMEFLARE_PATTERN]);
    expect(cooldown?.['default-days']).toBe(THIRD_PARTY_COOLDOWN_DAYS);
  });

  test('every group identifier is one Dependabot accepts', () => {
    // Dependabot: "must start and end with a letter"; letters, `|`, `_` and `-` between.
    for (const name of Object.keys(bun(MINI).groups)) {
      expect(name).toMatch(/^[A-Za-z](?:[A-Za-z|_-]*[A-Za-z])?$/);
    }
  });

  test('the Actions block stays weekly, and a publisher still watches its packages', () => {
    const actions = updates(MINI).find((u) => u['package-ecosystem'] === 'github-actions');
    expect(actions?.schedule.interval).toBe('weekly');
    expect(bun(MINI).directories).toEqual(['/']);
    expect(bun(KIT).directories).toEqual(['/', '/packages/*']);
  });
});

describe('the auto-merge workflow', () => {
  test('is rendered for every shape, as a path the drift check knows', () => {
    expect(RENDERED_PATHS).toContain('.github/workflows/dependabot-automerge.yml');
    for (const shape of [MINI, KIT]) {
      expect(Object.keys(automerge(shape).jobs)).toEqual(['arm']);
    }
  });

  test('grants nothing at the top and exactly the documented pair to its one job', () => {
    const parsed = automerge(MINI);
    expect(parsed.permissions).toEqual({});
    expect(parsed.jobs['arm']?.permissions).toEqual({
      contents: 'write',
      'pull-requests': 'write',
    });
  });

  test('runs where the rest of the repository runs', () => {
    expect(automerge(MINI).jobs['arm']?.['runs-on']).toEqual(['self-hosted', 'homeflare-mini']);
    expect(automerge(KIT).jobs['arm']?.['runs-on']).toBe('ubuntu-latest');
  });

  test('uses no action at all — only a run step and the GitHub CLI', () => {
    const steps = automerge(MINI).jobs['arm']?.steps ?? [];
    expect(steps.every((step) => step.uses === undefined)).toBe(true);
    expect(steps.at(-1)?.run).toContain('gh pr merge --auto --squash "$PR_URL"');
  });

  test('is gated on Dependabot twice and on the group branch prefix', () => {
    const condition = automerge(MINI).jobs['arm']?.if ?? '';
    expect(condition).toContain("github.event.pull_request.user.login == 'dependabot[bot]'");
    expect(condition).toContain("github.actor == 'dependabot[bot]'");
    expect(condition).toContain(`startsWith(github.head_ref, '${GROUP_BRANCH_PREFIX}')`);
  });

  test('the branch is passed through the environment, never spliced into the script', () => {
    const step = automerge(MINI).jobs['arm']?.steps.at(-1);
    // ⚠️ Actions expressions, compared verbatim — not template literals.
    // oxlint-disable-next-line no-template-curly-in-string
    expect(step?.env?.['HEAD_REF']).toBe('${{ github.head_ref }}');
    // oxlint-disable-next-line no-template-curly-in-string
    expect(step?.env?.['BASE_REF']).toBe('${{ github.base_ref }}');
    expect(step?.run).not.toContain('${{');
  });
});

/**
 * ⛔ RUN, NOT READ: the rendered step under bash, with `gh` replaced by a stub on PATH that
 *   answers the rules read with `REQUIRED` and records every call. `gh pr merge --auto` merges
 *   at once when nothing requires a check (automerge.ts), so the refusal is the behaviour.
 */
describe('the arming step, executed', () => {
  const arm = (required: string, headRef = `dependabot/bun/${HOMEFLARE_GROUP}-0a1b2c3d4e`) => {
    const dir = mkdtempSync(join(tmpdir(), 'automerge-'));
    const calls = join(dir, 'calls');
    writeFileSync(
      join(dir, 'gh'),
      '#!/bin/sh\necho "$*" >> "$CALLS"\n[ "$1" = api ] && echo "$REQUIRED"\nexit 0\n',
    );
    chmodSync(join(dir, 'gh'), 0o755);
    const run = automerge(MINI).jobs['arm']?.steps.at(-1)?.run ?? '';
    const env = { BASE_REF: 'main', CALLS: calls, GITHUB_REPOSITORY: 'o/r', HEAD_REF: headRef };
    const proc = Bun.spawnSync(['bash', '-c', run], {
      env: { ...env, PATH: `${dir}:${process.env['PATH'] ?? ''}`, PR_URL: 'u', REQUIRED: required },
    });
    const log = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [];
    rmSync(dir, { force: true, recursive: true });
    return { code: proc.exitCode, calls: log };
  };

  test('a base branch that requires no status check: fails, and never calls merge', () => {
    const { code, calls } = arm('0');
    expect(code).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStartWith('api repos/o/r/rules/branches/main ');
  });

  test('a required check on the base branch: arms auto-merge, squash', () => {
    const { code, calls } = arm('1');
    expect(code).toBe(0);
    expect(calls.at(-1)).toBe('pr merge --auto --squash u');
  });

  test('not the group branch: reads nothing, arms nothing', () => {
    expect(arm('1', 'dependabot/bun/homeflare/config-0.9.0')).toEqual({ code: 0, calls: [] });
  });
});

describe("the group's branch, as dependabot-core names it", () => {
  const exact = new RegExp(GROUP_BRANCH);

  test('matches a group branch at the repository root', () => {
    // `dependabot` / `bun` / (root collapses) / `<group>-<first 10 hex of an MD5>`.
    expect(exact.test(`dependabot/bun/${HOMEFLARE_GROUP}-0a1b2c3d4e`)).toBe(true);
  });

  test.each([
    ['a solo @homeflare/config update', 'dependabot/bun/homeflare/config-0.9.0'],
    ['a third-party package whose name starts the same', 'dependabot/bun/homeflare-x-1.2.3'],
    ['another group', 'dependabot/bun/lint-and-format-0a1b2c3d4e'],
    ['a security group', 'dependabot/bun/group-security-bun-0a1b2c3d4e'],
    ['a digest one character too long', `dependabot/bun/${HOMEFLARE_GROUP}-0a1b2c3d4e5`],
  ])('does not match %s', (_what, branch) => {
    expect(exact.test(branch)).toBe(false);
  });
});
