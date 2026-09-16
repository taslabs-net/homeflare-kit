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
const workflows = ['ci', 'release', 'security'];

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

    // ⚠️ Not every workflow uses an action — approve-bot-runs is pure `gh` CLI, which is
    //   the smaller supply-chain surface, not an omission. What matters is that any
    //   action it DOES use is pinned.
    for (const ref of uses as readonly string[]) {
      // ⛔ `owner/repo@ref` with a real ref. A bare `owner/repo` follows the default
      //   branch, which is an unpinned supply-chain dependency.
      expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@v[\d.]+$/);
    }
  });

  test.each(workflows)('%s uses only approved publishers', async (name) => {
    // ⛔ First-party (`actions/*`) or the vendor's own action for the tool it wraps.
    //   Adding a name here is a deliberate supply-chain decision, not a convenience.
    const approved = new Set(['actions', 'oven-sh', 'changesets', 'gitleaks']);
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

  test('auto-approval is scoped to the release bot and its branch only', async () => {
    // ⛔ THE TRUST BOUNDARY. Approving runs automatically is safe ONLY because all three
    //   filters apply together: the branch is the one only the release workflow creates,
    //   the actor is the bot, and the run is actually parked. Losing any one would
    //   auto-approve a stranger's fork PR, which is what the policy exists to stop.
    const text = await Bun.file(
      new URL('../.github/workflows/release.yml', import.meta.url),
    ).text();

    expect(text).toContain('changeset-release/main');
    expect(text).toContain('github-actions[bot]');
    expect(text).toContain('action_required');
  });

  test('dependabot config is at .github/ and covers bun plus actions', async () => {
    // ⛔ .github/dependabot.yml, NOT .github/workflows/. Dependabot is a platform
    //   feature, not an Action: misplaced, it is ignored in silence.
    const text = await Bun.file(new URL('../.github/dependabot.yml', import.meta.url)).text();
    const doc = Bun.YAML.parse(text) as {
      updates: readonly { 'package-ecosystem': string }[];
    };
    const ecosystems = doc.updates.map((u) => u['package-ecosystem']);

    expect(ecosystems).toContain('bun');
    expect(ecosystems).toContain('github-actions');
  });

  test('issue templates exist and force a package choice', async () => {
    // ★ The forms exist to collect WHICH package and WHICH runtime up front; without
    //   those two fields every report costs a round-trip.
    const dir = new URL('../.github/ISSUE_TEMPLATE/', import.meta.url);

    for (const name of ['bug.yml', 'feature.yml']) {
      const doc = Bun.YAML.parse(await Bun.file(new URL(name, dir)).text()) as {
        body: readonly { id?: string; validations?: { required?: boolean } }[];
      };
      const pkg = doc.body.find((f) => f.id === 'package');

      expect(pkg?.validations?.required).toBe(true);
    }
  });

  test('release verify runs only when this push will publish', async () => {
    // ⛔ THE FLAKE THIS STOPS, measured 2026-09-16. release.yml ran `bun run verify` on
    //   every push to main. `ci` on the same SHA was already green; a 5s DNS hang in
    //   alchemy's cluster failover test failed release and blocked the Version Packages
    //   PR. A feature merge still has `.changeset/*.md`; the version commit consumes
    //   them. Required `ci` gates the merge. Verify stays here for the publish.
    const text = await Bun.file(
      new URL('../.github/workflows/release.yml', import.meta.url),
    ).text();
    const doc = Bun.YAML.parse(text) as {
      jobs: { release: { steps: readonly (Step & { if?: string })[] } };
    };
    const verify = doc.jobs.release.steps.find((s) => s.run === 'bun run verify');

    expect(verify?.if).toBeTruthy();
    expect(text).toContain('.changeset');
    expect(text).toContain('has=false');
  });

  test('the test job builds before it tests, so the dist guard cannot skip itself', async () => {
    const text = await Bun.file(new URL('../.github/workflows/ci.yml', import.meta.url)).text();
    const doc = Bun.YAML.parse(text) as {
      jobs: Record<string, { steps: readonly Step[] }>;
    };
    const runs = (doc.jobs['test']?.steps ?? []).flatMap((s) =>
      s.run === undefined ? [] : [s.run],
    );

    expect(runs.indexOf('bun run build')).toBeLessThan(runs.indexOf('bun test'));
  });

  test('ci exposes one aggregate check that depends on every other job', async () => {
    // ★ A branch rule requires the `ci` check alone. Without this aggregate, adding a
    //   job means editing branch protection too — and forgetting leaves the new job
    //   advisory with nothing to say so.
    const text = await Bun.file(new URL('../.github/workflows/ci.yml', import.meta.url)).text();
    const doc = Bun.YAML.parse(text) as {
      jobs: Record<string, { needs?: readonly string[] }>;
    };
    const jobs = Object.keys(doc.jobs).filter((j) => j !== 'ci');

    expect(doc.jobs['ci']?.needs).toEqual(expect.arrayContaining(jobs));
  });
});
