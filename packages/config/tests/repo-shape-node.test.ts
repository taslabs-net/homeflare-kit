/**
 * The two inputs added for the repositories the first render could not have taken:
 * `node:` on the shape, and `timeout:` on an extra job.
 *
 * ★ WHY THESE ARE INPUTS AND NOT EXCEPTIONS. Measured 2026-09-22, homeflare-alerts and
 *   homeflare-blog both hand-wrote the same `actions/setup-node@v6` block, for two
 *   different but equally real reasons (a test that spawns `node`; Payload's Node >=24.15
 *   floor). Excepting `ci.yml` in both would have handed the estate's two most
 *   complicated CI files straight back to hand-editing.
 *
 * ⛔ EVERY WORKFLOW ASSERTION PARSES THE YAML. Grepping for `setup-node` would pass on a
 *   file GitHub cannot load, and on one where the step landed in the wrong job.
 */
import { describe, expect, test } from 'bun:test';
import { type RepoShape, extraJob, renderRepoShape } from '../src/repo-shape.ts';

interface Job {
  readonly steps?: readonly { readonly uses?: string; readonly with?: Record<string, unknown> }[];
  readonly 'timeout-minutes'?: number;
}

const BUN_ONLY: RepoShape = {
  owner: 'taslabs-net',
  publishes: false,
  repository: 'homeflare-secrets',
  runner: 'mini',
};

const WITH_NODE: RepoShape = { ...BUN_ONLY, node: 24, repository: 'homeflare-alerts' };

function jobs(shape: RepoShape): Record<string, Job> {
  const yaml = renderRepoShape(shape).files['.github/workflows/ci.yml'] ?? '';
  return (Bun.YAML.parse(yaml) as { jobs: Record<string, Job> }).jobs;
}

function uses(job: Job | undefined): string[] {
  return (job?.steps ?? []).flatMap((step) => (step.uses === undefined ? [] : [step.uses]));
}

describe('node: is an input, and it reaches exactly the jobs that install', () => {
  test('omitting it renders no setup-node anywhere', () => {
    const rendered = renderRepoShape(BUN_ONLY).files['.github/workflows/ci.yml'] ?? '';
    expect(rendered).not.toContain('setup-node');
  });

  test('declaring it puts node before bun in `check`', () => {
    // ⚠️ ORDER IS THE ASSERTION, NOT PRESENCE. setup-bun after setup-node is what leaves
    //   bun first on PATH while a real `node` is still resolvable — the arrangement both
    //   repositories had written by hand.
    expect(uses(jobs(WITH_NODE)['check'])).toEqual([
      'actions/checkout@v7',
      'actions/setup-node@v6',
      'oven-sh/setup-bun@v2',
    ]);
  });

  test('the node step pins the declared major and declines the npm cache', () => {
    const step = (jobs(WITH_NODE)['check']?.steps ?? []).find(
      (candidate) => candidate.uses === 'actions/setup-node@v6',
    );
    expect(step?.with).toEqual({ 'node-version': 24, 'package-manager-cache': 'false' });
  });

  test('`workflow lint` never gets it — that job installs nothing', () => {
    expect(uses(jobs(WITH_NODE)['workflows'])).toEqual(['actions/checkout@v7']);
  });

  test('an extra job on the bun prologue gets it too', () => {
    const shape: RepoShape = {
      ...WITH_NODE,
      extraJobs: [
        extraJob({
          id: 'build',
          name: 'build',
          reason: 'ships a Vite frontend the Worker serves; no other estate repository does',
          steps: [{ run: 'bun run build:web' }],
        }),
      ],
    };
    expect(uses(jobs(shape)['build'])).toContain('actions/setup-node@v6');
  });

  test('a non-integer or non-positive major fails the render, not the job', () => {
    expect(() => renderRepoShape({ ...BUN_ONLY, node: 24.5 })).toThrow('positive integer major');
    expect(() => renderRepoShape({ ...BUN_ONLY, node: 0 })).toThrow('positive integer major');
  });
});

describe('timeout: belongs to the job that waits on something', () => {
  const parity = extraJob({
    id: 'runtime',
    name: 'Blog workerd parity',
    reason: 'drives Playwright against a local workerd, which can hang instead of failing',
    steps: [{ run: 'bun run verify:runtime' }],
    timeout: 15,
  });

  test('it renders as `timeout-minutes` on that job alone', () => {
    const rendered = jobs({ ...BUN_ONLY, extraJobs: [parity] });
    expect(rendered['runtime']?.['timeout-minutes']).toBe(15);
    expect(rendered['check']?.['timeout-minutes']).toBeUndefined();
    expect(rendered['ci']?.['timeout-minutes']).toBeUndefined();
  });

  test('omitting it renders no key at all, so GitHub keeps its own default', () => {
    const rendered = jobs({
      ...BUN_ONLY,
      extraJobs: [
        extraJob({
          id: 'coverage',
          name: 'unit coverage floor',
          reason: 'the vitest floor ratchets up only, and a slip is its own red X',
          steps: [{ run: 'bun run coverage' }],
        }),
      ],
    });
    expect(rendered['coverage']?.['timeout-minutes']).toBeUndefined();
  });

  // ⚠️ WRITTEN OUT IN FULL, NOT SPREAD FROM `parity`. A spread carries the reason in as
  //   the wide `string` type, which `Stated` collapses to `never` — so the shorthand does
  //   not compile, and that refusal is the feature rather than a nuisance to work around.
  test('a fractional or non-positive timeout is refused at declaration', () => {
    expect(() =>
      extraJob({
        id: 'runtime',
        name: 'Blog workerd parity',
        reason: 'drives Playwright against a local workerd, which can hang instead of failing',
        steps: [{ run: 'bun run verify:runtime' }],
        timeout: 0.5,
      }),
    ).toThrow('positive whole minute count');
    expect(() =>
      extraJob({
        id: 'runtime',
        name: 'Blog workerd parity',
        reason: 'drives Playwright against a local workerd, which can hang instead of failing',
        steps: [{ run: 'bun run verify:runtime' }],
        timeout: 0,
      }),
    ).toThrow('positive whole minute count');
  });
});
