/**
 * Rendering is deterministic, valid, and reflects only the input.
 *
 * ⛔ EVERY WORKFLOW ASSERTION PARSES THE YAML. A test that greps for a substring passes on
 *   a file GitHub cannot load; `Bun.YAML.parse` is what proves the emitter, and it is
 *   native so it costs no dependency.
 */
import { describe, expect, test } from 'bun:test';
import { type RepoShape, extraJob, renderRepoShape } from '../src/repo-shape.ts';

const PROXMOX: RepoShape = {
  owner: 'taslabs-net',
  publishes: false,
  repository: 'homeflare-proxmox',
  runner: 'mini',
};

const KIT: RepoShape = {
  owner: 'taslabs-net',
  publishes: true,
  repository: 'homeflare-kit',
  runner: 'github',
};

function ci(shape: RepoShape): Record<string, unknown> {
  return Bun.YAML.parse(renderRepoShape(shape).files['.github/workflows/ci.yml'] ?? '') as Record<
    string,
    unknown
  >;
}

function jobs(
  shape: RepoShape,
): Record<string, { name: string; needs?: string[]; 'runs-on': unknown }> {
  return ci(shape)['jobs'] as Record<
    string,
    { name: string; needs?: string[]; 'runs-on': unknown }
  >;
}

describe('rendering is deterministic', () => {
  test('the same input renders byte-identical output, twice', () => {
    const once = renderRepoShape(PROXMOX).files;
    const twice = renderRepoShape(PROXMOX).files;
    expect(twice).toEqual(once);
  });

  test('two repositories differ only where their inputs differ', () => {
    const mini = renderRepoShape(PROXMOX).files['.github/workflows/security.yml'] ?? '';
    const other =
      renderRepoShape({ ...PROXMOX, repository: 'homeflare-wiki' }).files[
        '.github/workflows/security.yml'
      ] ?? '';
    // ★ security.yml names no repository, so two repositories on the same runner get the
    //   identical file. That is the property thirteen hand-written copies did not have.
    expect(other).toBe(mini);
  });
});

describe('the workflows are valid and wired to one required check', () => {
  test('ci.yml parses and has no push trigger', () => {
    const parsed = ci(PROXMOX);
    // ⚠️ `on` is a YAML 1.1 boolean, so a parser may key the trigger map as `true`.
    const on = (parsed['on'] ?? parsed[true as unknown as string]) as Record<string, unknown>;
    expect(Object.keys(on)).toEqual(['pull_request']);
  });

  test('the aggregate needs every other job', () => {
    const shape: RepoShape = {
      ...PROXMOX,
      extraJobs: [
        extraJob({
          id: 'build',
          name: 'build',
          reason: 'ships a Vite frontend the Worker serves, which no other repository does',
          steps: [{ run: 'bun run build:web' }],
        }),
      ],
    };
    const rendered = jobs(shape);
    expect(Object.keys(rendered).sort()).toEqual(['build', 'check', 'ci', 'workflows']);
    expect(rendered['ci']?.needs).toEqual(['check', 'workflows', 'build']);
  });

  test('the required checks are the aggregates, never a leaf job', () => {
    expect(renderRepoShape(PROXMOX).policy.checks).toEqual(['ci', 'secret scan']);
    const names = Object.values(jobs(PROXMOX)).map((job) => job.name);
    expect(names).toContain('ci');
  });

  test("the check job runs the repository's own gate, not a copy of its lanes", () => {
    const text = renderRepoShape(PROXMOX).files['.github/workflows/ci.yml'] ?? '';
    expect(text).toContain('- run: bun run check');
    // ⛔ A workflow that re-lists the lanes can check LESS than `bun run check` does;
    //   homeflare-kit's check builds before testing and its dist test skips without it.
    expect(text).not.toMatch(/- run: bun run (lint|types|test)$/m);
    expect(text).not.toMatch(/- run: bun test$/m);
  });
});

describe('the runner is an input, and it moves every file that depends on it', () => {
  test('the mini gets a self-hosted label and an actionlint declaration for it', () => {
    const files = renderRepoShape(PROXMOX).files;
    expect(Object.values(jobs(PROXMOX)).map((job) => job['runs-on'])).toEqual([
      ['self-hosted', 'homeflare-mini'],
      ['self-hosted', 'homeflare-mini'],
      ['self-hosted', 'homeflare-mini'],
    ]);
    expect(files['.github/actionlint.yaml']).toContain('homeflare-mini');
  });

  test('a GitHub-hosted repository renders no actionlint config at all', () => {
    const files = renderRepoShape(KIT).files;
    // ★ Not an exception — an input. The file exists to declare a self-hosted label, so a
    //   repository with no self-hosted label needs no file and no reason for not having one.
    expect(files['.github/actionlint.yaml']).toBeUndefined();
    expect(Object.values(jobs(KIT)).map((job) => job['runs-on'])).toEqual([
      'ubuntu-latest',
      'ubuntu-latest',
      'ubuntu-latest',
    ]);
  });
});

describe('publishing decides the two changeset keys that ever differed', () => {
  test('a private repository gets privatePackages and restricted access', () => {
    const config = JSON.parse(
      renderRepoShape(PROXMOX).files['.changeset/config.json'] ?? '{}',
    ) as Record<string, unknown>;
    expect(config['access']).toBe('restricted');
    expect(config['privatePackages']).toEqual({ tag: false, version: true });
    expect(config['changelog']).toEqual([
      '@changesets/changelog-github',
      { repo: 'taslabs-net/homeflare-proxmox' },
    ]);
  });

  test('a publishing repository gets public access and no privatePackages', () => {
    const config = JSON.parse(
      renderRepoShape(KIT).files['.changeset/config.json'] ?? '{}',
    ) as Record<string, unknown>;
    expect(config['access']).toBe('public');
    expect(config['privatePackages']).toBeUndefined();
  });
});

describe('an extra job carries its reason into the file', () => {
  test('the rendered job says why this repository has it', () => {
    const shape: RepoShape = {
      ...PROXMOX,
      extraJobs: [
        extraJob({
          id: 'go',
          name: 'go build',
          reason: 'this repository ships Go plugin binaries alongside the TypeScript stack',
          steps: [{ run: 'go build ./...' }],
        }),
      ],
    };
    expect(renderRepoShape(shape).files['.github/workflows/ci.yml']).toContain(
      'ships Go plugin binaries alongside the TypeScript stack',
    );
  });

  test('a job id that YAML would not accept as a key is refused', () => {
    expect(() =>
      extraJob({
        id: 'Go Build',
        name: 'go',
        reason: 'a job id with spaces renders a workflow GitHub rejects at parse time',
        steps: [{ run: 'true' }],
      }),
    ).toThrow(/job id/);
  });
});
