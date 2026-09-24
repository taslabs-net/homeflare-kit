/**
 * Guards release.yml's `notify-consumers` job — the kit side of the auto-bumper.
 *
 * ★ SPLIT OUT OF workflows.test.ts (2026-09-23), which was over the 250-line cap. This
 *   file owns everything specific to the App-token dispatch to homeflare-bumper; the
 *   generic per-workflow checks (pins, publishers, parsing) stay in workflows.test.ts.
 */
import { describe, expect, test } from 'bun:test';

type Step = {
  readonly uses?: string;
  readonly run?: string;
  readonly id?: string;
  readonly if?: string;
  readonly env?: Readonly<Record<string, string>>;
};

async function releaseDoc(): Promise<{
  jobs: {
    release: { steps: readonly Step[]; outputs?: Readonly<Record<string, string>> };
    'notify-consumers': {
      needs?: string;
      if?: string;
      environment?: string;
      permissions?: Readonly<Record<string, unknown>>;
      steps: readonly Step[];
    };
  };
}> {
  const text = await Bun.file(new URL('../.github/workflows/release.yml', import.meta.url)).text();
  return Bun.YAML.parse(text) as Awaited<ReturnType<typeof releaseDoc>>;
}

describe('notify-consumers', () => {
  test('create-github-app-token is pinned by commit SHA, because it handles a private key', async () => {
    // ⛔ THE ONE DELIBERATE EXCEPTION to the major-tag convention (kit
    //   auto-bumper design): this action exchanges KIT_DISPATCH_APP_KEY for a token, so it
    //   gets the stricter pin every action that touches a secret should have.
    const doc = await releaseDoc();
    const ref = doc.jobs['notify-consumers'].steps.find((s) =>
      s.uses?.startsWith('actions/create-github-app-token'),
    )?.uses;

    expect(ref ?? '').toMatch(/^actions\/create-github-app-token@[0-9a-f]{40}$/);
  });

  test("release exposes changesets/action's own output names, unrenamed", async () => {
    // ⛔ notify-consumers reads these by name. `published` and `published-packages` are
    //   changesets/action's own outputs (verified against its v2.1.2 action.yml,
    //   2026-09-23) — renaming them here would silently disconnect the two jobs.
    const doc = await releaseDoc();
    const changesetsStep = doc.jobs.release.steps.find((s) =>
      s.uses?.startsWith('changesets/action'),
    );

    expect(changesetsStep?.id).toBe('changesets');
    expect(doc.jobs.release.outputs?.['published']).toContain('steps.changesets.outputs.published');
    expect(doc.jobs.release.outputs?.['published-packages']).toContain(
      'steps.changesets.outputs.published-packages',
    );
  });

  test('only runs after a real publish, with no ambient token', async () => {
    const job = (await releaseDoc()).jobs['notify-consumers'];

    expect(job.needs).toBe('release');
    expect(job.if).toContain("needs.release.outputs.published == 'true'");
    expect(job.environment).toBe('consumers');
    expect(job.permissions).toEqual({});
  });

  test('skips with a notice, never fails, when the dispatch App is unset', async () => {
    // ⛔ THE APP MAY NOT EXIST YET. Every step that needs KIT_DISPATCH_APP_CLIENT_ID is
    //   gated on it being non-empty, so a release before Tim creates the App still goes
    //   green — a release that already published must never turn red for a step that was
    //   always going to wait on a person.
    const steps = (await releaseDoc()).jobs['notify-consumers'].steps;

    expect(steps.some((s) => (s.if ?? '').includes("KIT_DISPATCH_APP_CLIENT_ID == ''"))).toBe(true);
    for (const step of steps) {
      const mintsOrDispatches =
        step.uses?.startsWith('actions/create-github-app-token') ||
        step.run?.includes('gh workflow run');
      if (mintsOrDispatches) {
        expect(step.if ?? '').toContain("KIT_DISPATCH_APP_CLIENT_ID != ''");
      }
    }
  });

  test('dispatches through env, nothing spliced into the shell line', async () => {
    const steps = (await releaseDoc()).jobs['notify-consumers'].steps;
    const dispatch = steps.find((s) => s.run?.includes('gh workflow run kit-bump.yml'));

    expect(dispatch?.run).toContain('-R taslabs-net/homeflare-bumper');
    expect(dispatch?.run).toContain('-f packages="$PACKAGES"');
    expect(dispatch?.run).toContain('-f source="$SOURCE"');
    expect(dispatch?.env?.['PACKAGES']).toContain('needs.release.outputs.published-packages');
    // ⚠️ An Actions expression, compared verbatim — not a template literal.
    // oxlint-disable-next-line no-template-curly-in-string
    expect(dispatch?.env?.['GH_TOKEN']).toBe('${{ steps.token.outputs.token }}');
  });

  test('--ref is explicit, because the App token cannot read the default branch', async () => {
    // ⛔ WITHOUT --ref, gh asks GraphQL for repository.defaultBranchRef — a read this
    //   App token does not have (only actions:write, metadata:read) — and the dispatch
    //   fails: "Resource not accessible by integration". Measured 2026-09-23, run
    //   35952899162. This pins the flag so it cannot silently regress.
    const steps = (await releaseDoc()).jobs['notify-consumers'].steps;
    const dispatch = steps.find((s) => s.run?.includes('gh workflow run kit-bump.yml'));

    expect(dispatch?.run).toContain('--ref main');
    // kit-bump.yml's dry_run input defaults to true; an automatic dispatch must be a real run.
    expect(dispatch?.run).toContain('-f dry_run=false');
  });
});
