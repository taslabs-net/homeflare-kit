/**
 * Guards the GitHub Actions workflows themselves.
 *
 * ★ WHY TEST YAML. This repo is the template every HomeFlare project copies, so a
 *   mistake in these files is not one broken build — it is the shape every future repo
 *   inherits. Parsed with Bun.YAML, no dependency.
 *
 * ⚠️ THE FAILURE THIS CATCHES, MEASURED 2026-09-15. The first draft pinned
 *   actions/checkout@v5 (current: v7), setup-node@v6 (current: v7) and
 *   changesets/action@v1 — whose v2 renamed every input. Stale pins do not error; they
 *   run old code, or in changesets' case silently do nothing recognisable.
 */
import { describe, expect, test } from 'bun:test';

type Step = { readonly uses?: string; readonly run?: string };

// ⚠️ NOT `as const`: test.each's signature takes a mutable array, so a readonly tuple
//   fails to typecheck while passing at run time (TS2769).
const workflows = ['ci', 'release'];

async function stepsOf(name: string): Promise<readonly Step[]> {
  const text = await Bun.file(new URL(`../.github/workflows/${name}.yml`, import.meta.url)).text();
  const doc = Bun.YAML.parse(text) as {
    jobs: Record<string, { steps: readonly Step[] }>;
  };
  return Object.values(doc.jobs).flatMap((job) => job.steps);
}

describe('workflows', () => {
  test.each(workflows)('%s parses and every action is version-pinned', async (name) => {
    const steps = await stepsOf(name);
    const uses = steps.flatMap((s) => (s.uses === undefined ? [] : [s.uses]));

    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses as readonly string[]) {
      // ⛔ `owner/repo@ref` with a real ref. A bare `owner/repo` follows the default
      //   branch, which is an unpinned supply-chain dependency.
      expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@v[\d.]+$/);
    }
  });

  test.each(workflows)('%s uses only approved publishers', async (name) => {
    // ⛔ First-party (`actions/*`) or the vendor's own action for the tool it wraps.
    //   Adding a name here is a deliberate supply-chain decision, not a convenience.
    const approved = new Set(['actions', 'oven-sh', 'changesets']);
    const steps = await stepsOf(name);

    const uses = steps.flatMap((s) => (s.uses === undefined ? [] : [s.uses])) as readonly string[];

    for (const ref of uses) {
      // ⚠️ noUncheckedIndexedAccess types [0] as possibly-undefined; the ?? keeps the
      //   assertion honest instead of silencing it with a non-null assertion.
      expect(approved).toContain(ref.split('/')[0] ?? '');
    }
  });

  test('changesets/action is pinned exactly, because it publishes no floating major', async () => {
    // ⚠️ Measured 2026-09-15: the repo ships v2.0.0…v2.1.2 and no `v2` tag, so `@v2`
    //   would 404 at run time rather than resolve to the newest v2.
    const steps = await stepsOf('release');
    const ref = steps.find((s) => s.uses?.startsWith('changesets/action'))?.uses;

    expect(ref ?? '').toMatch(/^changesets\/action@v\d+\.\d+\.\d+$/);
  });

  test('ci builds before it tests, so the dist guard cannot skip itself', async () => {
    const runs = (await stepsOf('ci')).flatMap((s) => (s.run === undefined ? [] : [s.run]));

    expect(runs.indexOf('bun run build')).toBeLessThan(runs.indexOf('bun test'));
  });
});
