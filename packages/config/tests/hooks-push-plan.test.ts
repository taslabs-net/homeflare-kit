/**
 * The pre-push plan, pinned against the estate's REAL `check` scripts.
 *
 * ★ THE TABLE IS THE SURVEY. Each row is a repository's `scripts` as origin/main held them on
 *   2026-09-23 (trimmed to what `check` reaches). A change to push-plan.ts that would run a
 *   build on push, drop a lint lane, or stop narrowing a test runner fails here, naming the
 *   repository it would have hit.
 */
import { describe, expect, test } from 'bun:test';
import { andChain, planLanes } from '../src/hooks/push-plan.ts';

const BASE = 'a1b2c3d4e5';

/** The plan as `kind: command` lines — the shape a person reads in the hook's output. */
function lines(scripts: Record<string, string>, base: string | undefined = BASE): string[] {
  return planLanes(scripts, base).map((lane) =>
    lane.kind === 'skip' ? `skip: ${lane.label}` : `${lane.kind}: ${lane.command}`,
  );
}

describe('andChain', () => {
  test('splits a plain chain', () => {
    expect(andChain('bun run lint && bun run types && bun test')).toEqual([
      'bun run lint',
      'bun run types',
      'bun test',
    ]);
  });

  test('keeps quoted text whole, && and globs included', () => {
    expect(andChain('bun test --path-ignore-patterns="a && b/**" && x')).toEqual([
      'bun test --path-ignore-patterns="a && b/**"',
      'x',
    ]);
  });

  test.each([
    ['a || b'],
    ['a ; b'],
    ['a | b'],
    ['a > out'],
    ['a & b'],
    ['echo $(date)'],
    ['echo `date`'],
    ['a && '],
    ['echo "unterminated'],
  ])('refuses %p — the pieces would mean something else apart', (script) => {
    expect(andChain(script)).toBeUndefined();
  });
});

describe('the estate, as surveyed on 2026-09-23', () => {
  test('homeflare-kit: lint and types as written, build left to CI, tests narrowed', () => {
    const kit = {
      lint: 'oxfmt --check . && oxlint --deny-warnings .',
      types: "tsc --noEmit && bun run --filter '*' types",
      build: "bun run --filter '*' build",
      check: 'bun run lint && bun run types && bun run build && bun test',
      verify: 'bun run check && bun run smoke',
    };
    expect(lines(kit)).toEqual([
      'run: bun run lint',
      'run: bun run types',
      'skip: bun run build',
      `test: bun test --changed=${BASE}`,
    ]);
  });

  test('landscape root: the repo-only ignore pattern survives the narrowing', () => {
    const landscape = {
      lint: 'oxfmt --check scripts tests && oxlint --deny-warnings scripts tests',
      types: 'tsc --noEmit',
      test: 'bun test --path-ignore-patterns="homeflare-*/**"',
      check:
        'bun run scripts/plugin-manifests.ts --check && bun run lint && bun run types && bun run test',
    };
    expect(lines(landscape)).toEqual([
      'run: bun run scripts/plugin-manifests.ts --check',
      'run: bun run lint',
      'run: bun run types',
      `test: bun test --path-ignore-patterns="homeflare-*/**" --changed=${BASE}`,
    ]);
  });

  test('homeflare-alerts: a named build is skipped even at the end of the chain', () => {
    const alerts = {
      lint: 'oxfmt --check . && oxlint --deny-warnings . && bun run check:version',
      'check:version': 'bun run scripts/write-version.ts --check',
      'check:types': 'bun --bun tsc --noEmit',
      'build:web': 'vite build',
      check: 'bun run lint && bun run check:types && bun test && bun run build:web',
    };
    expect(lines(alerts)).toEqual([
      'run: bun run lint',
      'run: bun run check:types',
      `test: bun test --changed=${BASE}`,
      'skip: bun run build:web',
    ]);
  });

  test('homeflare-subnet-calc: a check that delegates to verify is followed, not refused', () => {
    const subnet = {
      lint: 'oxfmt --check . && oxlint --deny-warnings .',
      types: 'tsc --noEmit && tsc -p web/tsconfig.json --noEmit',
      verify: 'bun run lint && bun run types && bun test',
      check: 'bun run verify',
    };
    expect(lines(subnet)).toEqual([
      'run: bun run lint',
      'run: bun run types',
      `test: bun test --changed=${BASE}`,
    ]);
  });

  test('homeflare-blog: a test chain is opened; its vitest half runs in full', () => {
    const blog = {
      lint: 'oxfmt --check . && oxlint --deny-warnings .',
      types: 'tsc --noEmit',
      test: 'bun run test:repo && bun run test:unit',
      'test:repo': 'bun test tests/repo',
      'test:unit': 'cross-env NODE_OPTIONS=--no-deprecation vitest run tests/unit',
      check: 'bun run lint && bun run types && bun run test',
    };
    expect(lines(blog)).toEqual([
      'run: bun run lint',
      'run: bun run types',
      `test: bun test tests/repo --changed=${BASE}`,
      'test: bun run test:unit',
    ]);
  });

  test('homeflare-anyauth: npm scripts followed; vitest with coverage runs whole, marked as tests', () => {
    const anyauth = {
      'fmt:check': 'oxfmt --check',
      lint: 'oxlint .',
      typecheck: 'tsc --noEmit',
      test: 'vitest run --coverage',
      'test:app': 'vitest run --config vitest.app.config.ts --coverage',
      verify:
        'npm run fmt:check && npm run lint && npm run typecheck && npm test && npm run test:app',
      check: 'npm run verify',
    };
    expect(lines(anyauth)).toEqual([
      'run: npm run fmt:check',
      'run: npm run lint',
      'run: npm run typecheck',
      'test: npm test',
      'test: npm run test:app',
    ]);
  });

  test('homeflare-desktop: no test lane in check, so none on push', () => {
    const desktop = {
      'format:check': 'oxfmt --check .',
      lint: 'oxlint --deny-warnings .',
      typecheck: 'tsc --noEmit',
      test: 'node --test --test-concurrency=1 tests/*.test.mjs',
      check: 'bun run format:check && bun run lint && bun run typecheck',
    };
    expect(lines(desktop)).toEqual([
      'run: bun run format:check',
      'run: bun run lint',
      'run: bun run typecheck',
    ]);
  });
});

describe('edges', () => {
  test('no base: the same lanes, tests in full', () => {
    const plan = planLanes({ check: 'bun run lint && bun test', lint: 'oxlint .' }, undefined);
    expect(plan).toEqual([
      { kind: 'run', label: 'bun run lint', command: 'bun run lint' },
      { kind: 'test', label: 'bun test', command: 'bun test', scoped: false },
    ]);
  });

  test('no check script: nothing, which the caller reports', () => {
    expect(planLanes({ test: 'bun test' }, BASE)).toEqual([]);
  });

  test('a check that is not a plain chain runs whole, marked unscoped', () => {
    expect(planLanes({ check: 'bun test || true' }, BASE)).toEqual([
      { kind: 'test', label: 'bun run check', command: 'bun run check', scoped: false },
    ]);
  });

  test('a test script that is not a chain runs in full and says it is a test', () => {
    expect(planLanes({ check: 'bun run test', test: 'bun test | tee log' }, BASE)).toEqual([
      { kind: 'test', label: 'bun run test', command: 'bun run test', scoped: false },
    ]);
  });

  test('a script that names itself stops expanding instead of recursing forever', () => {
    expect(lines({ check: 'bun run loop', loop: 'bun run loop' })).toEqual(['run: bun run loop']);
  });

  test('smoke is left to CI like build', () => {
    expect(lines({ check: 'bun run smoke:consumer', 'smoke:consumer': 'x' })).toEqual([
      'skip: bun run smoke:consumer',
    ]);
  });
});
