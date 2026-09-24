/**
 * K2 (2026-09-24): MEASURES `contextReportedSuccess` (repository-ruleset-octokit.ts) against a
 * real `@octokit/rest` instance with a fetch shim (no network) — the same pattern
 * repository-ruleset-wire.test.ts uses for H15, applied here to the "which ref did we check"
 * question instead of "did the wire field survive". The shim routes by URL path, not by call
 * order, so these tests exercise the SAME sequencing the real implementation performs: default
 * branch tip first, then (only if the tip has nothing) recent merged PR heads, bounded.
 *
 * Both sides the guard exists to hold: accept a context that reports only on a recent merged PR
 * head (the case K2 fixes — CI runs on `pull_request` only, never the tip), and still refuse one
 * that reports nowhere, tip or any recent merged head, INCLUDING one whose only success is
 * older than `RECENT_MERGED_PR_LIMIT` merges ago (the bound is real, not decorative).
 */
import { describe, expect, test } from 'bun:test';
import { Octokit } from '@octokit/rest';
import * as Effect from 'effect/Effect';
import { RECENT_MERGED_PR_LIMIT, contextReportedSuccess } from './repository-ruleset-octokit.ts';

interface CheckRun {
  readonly name: string;
  readonly conclusion: string | null;
}
interface Status {
  readonly context: string;
  readonly state: string;
}
interface MergedPull {
  readonly merged_at: string | null;
  readonly head: { readonly sha: string };
}

interface Fixture {
  readonly defaultBranch: string;
  readonly checkRuns?: Readonly<Record<string, readonly CheckRun[]>>;
  readonly statuses?: Readonly<Record<string, readonly Status[]>>;
  /** Already in the order GitHub's `sort: updated, direction: desc` would return — most
   * recently updated first. */
  readonly closedPulls?: readonly MergedPull[];
}

/** Routes by URL path, not call order — GET .../pulls, GET .../commits/{ref}/check-runs, GET
 * .../commits/{ref}/statuses, else the bare repo GET (`default_branch`). `captured` records
 * every URL so a test can assert a ref was — or, for boundedness, was NEVER — looked up. */
function makeServingFetch(fx: Fixture, captured: string[]): typeof fetch {
  const respond = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    captured.push(url);
    if (/\/pulls(\?|$)/.test(url)) return respond(fx.closedPulls ?? []);
    const commits = /\/commits\/([^/?]+)\/(check-runs|statuses)/.exec(url);
    if (commits) {
      const [, ref, kind] = commits;
      if (kind === 'check-runs') {
        const runs = fx.checkRuns?.[ref as string] ?? [];
        return respond({ total_count: runs.length, check_runs: runs });
      }
      return respond(fx.statuses?.[ref as string] ?? []);
    }
    return respond({ default_branch: fx.defaultBranch });
  }) as typeof fetch;
}

const octokitOver = (fx: Fixture, captured: string[] = []) =>
  new Octokit({
    auth: 'fake-token-not-a-real-credential',
    request: { fetch: makeServingFetch(fx, captured) },
  });

const run = (eff: Effect.Effect<boolean, Error>): Promise<boolean> => Effect.runPromise(eff);

describe('contextReportedSuccess', () => {
  test('accepts a context that reports only on a recent merged PR head, not the tip', async () => {
    const octokit = octokitOver({
      defaultBranch: 'main',
      checkRuns: { sha2: [{ name: 'ci', conclusion: 'success' }] },
      closedPulls: [
        { merged_at: '2026-09-20T00:00:00Z', head: { sha: 'sha3' } },
        { merged_at: '2026-09-19T00:00:00Z', head: { sha: 'sha2' } },
        { merged_at: '2026-09-18T00:00:00Z', head: { sha: 'sha1' } },
      ],
    });
    const reported = await run(
      contextReportedSuccess(octokit, 'taslabs-net', 'homeflare-builds', 'ci'),
    );
    expect(reported).toBe(true);
  });

  test('refuses a context that reports nowhere — tip or any recent merged head', async () => {
    const octokit = octokitOver({
      defaultBranch: 'main',
      closedPulls: [
        { merged_at: '2026-09-20T00:00:00Z', head: { sha: 'sha3' } },
        { merged_at: '2026-09-19T00:00:00Z', head: { sha: 'sha2' } },
      ],
    });
    const reported = await run(
      contextReportedSuccess(octokit, 'taslabs-net', 'homeflare-builds', 'ci'),
    );
    expect(reported).toBe(false);
  });

  test('a success older than RECENT_MERGED_PR_LIMIT merges ago is still refused — the bound is real', async () => {
    // RECENT_MERGED_PR_LIMIT (10) merged PRs report nothing; only the 11th (oldest returned,
    // outside the bound) reports `ci` — proves the function stops at the limit rather than
    // scanning everything the list call happened to return.
    const closedPulls: MergedPull[] = Array.from({ length: RECENT_MERGED_PR_LIMIT }, (_, i) => ({
      merged_at: `2026-09-${String(20 - i)}T00:00:00Z`,
      head: { sha: `within-bound-${String(i)}` },
    }));
    closedPulls.push({ merged_at: '2026-08-01T00:00:00Z', head: { sha: 'beyond-bound' } });
    const captured: string[] = [];
    const octokit = octokitOver(
      {
        defaultBranch: 'main',
        checkRuns: { 'beyond-bound': [{ name: 'ci', conclusion: 'success' }] },
        closedPulls,
      },
      captured,
    );
    const reported = await run(
      contextReportedSuccess(octokit, 'taslabs-net', 'homeflare-builds', 'ci'),
    );
    expect(reported).toBe(false);
    expect(captured.some((url) => url.includes('/commits/beyond-bound/'))).toBe(false);
  });

  test('the default branch tip alone is still enough — no fallback needed', async () => {
    const octokit = octokitOver({
      defaultBranch: 'main',
      statuses: { main: [{ context: 'secret scan', state: 'success' }] },
    });
    const reported = await run(
      contextReportedSuccess(octokit, 'taslabs-net', 'homeflare-kit', 'secret scan'),
    );
    expect(reported).toBe(true);
  });
});
