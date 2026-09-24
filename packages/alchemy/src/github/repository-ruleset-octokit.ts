/**
 * The real {@link RulesetOctokit} — every wire call this family makes, built from the EXPORTED
 * `GitHubCredentials` service via `creds.octokit()`, exactly upstream's own `octokitFor` does
 * (`node_modules/alchemy/src/GitHub/Octokit.ts`). H15: Octokit, not `@distilled.cloud/github`
 * — its `S.Struct` request schemas have no field for `require_extra_approval_for_unattributed_
 * changes` and would very likely strip an unknown key on encode; Octokit's REST methods hand
 * their `parameters` object to `@octokit/endpoint` mostly as-is, so an extra JSON body key
 * should reach the wire. repository-ruleset-wire.test.ts MEASURES this against a real Octokit
 * instance with a fetch shim rather than asserting it from reading the source.
 *
 * ★ K2 (2026-09-24): "REPORTED SUCCESS" IS THE DEFAULT BRANCH'S TIP, THEN RECENT MERGED PR
 *   HEADS — NOT FULL HISTORY. The rendered CI (`packages/config/src/repo-shape/ci.ts`) triggers
 *   on `pull_request` ONLY, deliberately (measured 2026-09-15..22: 613 of 619 main-push runs
 *   duplicated an already-green PR run, ~41% of the mini's CI load) — so `ci`/`secret scan`/
 *   `CodeQL` NEVER report on the default branch's tip itself, only on PR heads. Checking the tip
 *   alone therefore refused adding any of them everywhere, including homeflare-builds' pending
 *   first ruleset. `contextReportedSuccess` now falls back to `recentMergedHeadShas` — bounded
 *   (`RECENT_MERGED_PR_LIMIT` heads, from one `per_page`-bounded list call, never the repo's
 *   full PR history) — so a context that only ever reports on PR heads is no longer refused
 *   everywhere, while a context that has never reported ANYWHERE (not the tip, not any recent
 *   merged head) still is: `NeverReportedContext`'s whole purpose survives unchanged.
 * ⚠️ Still not full history: a context whose only successful run predates
 *   `RECENT_MERGED_PR_LIMIT` merges ago reads as never-reported until it runs again. Widening
 *   the bound trades this guard's cost (more vendor calls per newly-required context) against
 *   its reach; `RECENT_MERGED_PR_LIMIT` is a deliberate, named number for exactly that reason,
 *   not a magic constant.
 */
import type { Octokit as OctokitClient } from '@octokit/rest';
import { GitHubCredentials } from 'alchemy/GitHub';
import * as Effect from 'effect/Effect';
import type { CreateRulesetBody } from './repository-ruleset-constraints.ts';
import type { RulesetOctokit, RulesetRecord, RulesetSummary } from './repository-ruleset-probe.ts';

export type RealRulesetOctokit = RulesetOctokit<GitHubCredentials>;

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

const octokitFor = (
  baseUrl: string | undefined,
): Effect.Effect<OctokitClient, Error, GitHubCredentials> =>
  Effect.gen(function* () {
    const creds = yield* yield* GitHubCredentials;
    return baseUrl === undefined ? creds.octokit() : creds.octokit({ baseUrl });
  }).pipe(Effect.mapError(asError));

const is404 = (e: unknown): boolean => (e as { status?: number } | undefined)?.status === 404;

/** How many of the most-recently-updated MERGED pull requests' head SHAs to check, once the
 * default branch's own tip has no reported success — see the file header (K2). */
export const RECENT_MERGED_PR_LIMIT = 10;
/** How many closed PRs to list (in one bounded call) to find up to `RECENT_MERGED_PR_LIMIT`
 * merged ones among them — larger than the limit because `state: 'closed'` also returns PRs
 * closed without merging, sorted by `updated_at`, not `merged_at` (the REST API has no
 * merged-only list). A GitHub API list call has no `merged` filter, so this is `100` — GitHub's
 * own per-page maximum, not a smaller round number — to keep unmerged churn (e.g. Dependabot
 * PRs closed without merging, which still bump `updated_at`) from crowding out real merges in a
 * repo with heavy PR traffic (2026-09-24 review finding: a smaller page risked under-reaching in
 * exactly the kind of repo this fix targets). Still bounded, still one call, still never the
 * repo's full history — a repo whose last `RECENT_MERGED_PR_LIMIT` merges don't even fit in the
 * last 100 closed PRs is treated the same as one with too little history: fewer heads found,
 * same "still refused" fallback. */
const RECENT_CLOSED_PR_PAGE_SIZE = 100;

/** Whether `context` reported success for a single ref — a branch tip or a PR head SHA, both
 * checked the same way (checks + statuses, exactly as GitHub's own UI does). Takes a plain
 * `OctokitClient`, not an Effect service, so it and its caller below are testable directly
 * against a real `@octokit/rest` instance with a fetch shim (repository-ruleset-octokit.test.ts)
 * — no `GitHubCredentials` layer needed, mirroring `desiredWireRuleset`'s pure-function seam. */
export const hasRefReportedSuccess = (
  octokit: OctokitClient,
  owner: string,
  repo: string,
  ref: string,
  context: string,
): Effect.Effect<boolean, Error> =>
  Effect.gen(function* () {
    const [checkRuns, statuses] = yield* Effect.all([
      Effect.tryPromise({
        try: () => octokit.rest.checks.listForRef({ owner, repo, ref, check_name: context }),
        catch: asError,
      }),
      Effect.tryPromise({
        try: () => octokit.rest.repos.listCommitStatusesForRef({ owner, repo, ref }),
        catch: asError,
      }),
    ]);
    const checkReported = checkRuns.data.check_runs.some(
      (run) => run.name === context && run.conclusion === 'success',
    );
    const statusReported = statuses.data.some(
      (status) => status.context === context && status.state === 'success',
    );
    return checkReported || statusReported;
  });

/** The head SHAs of up to `RECENT_MERGED_PR_LIMIT` most-recently-updated MERGED pull requests
 * against `base` — one bounded list call (`RECENT_CLOSED_PR_PAGE_SIZE` closed PRs), filtered to
 * merged, then capped. Never paginates further: a repo whose last `RECENT_MERGED_PR_LIMIT`
 * merges are all older than its last `RECENT_CLOSED_PR_PAGE_SIZE` closed PRs simply yields fewer
 * than the limit, same as a repo with too little history — both are the "still refused" case. */
export const recentMergedHeadShas = (
  octokit: OctokitClient,
  owner: string,
  repo: string,
  base: string,
): Effect.Effect<readonly string[], Error> =>
  Effect.gen(function* () {
    const closed = yield* Effect.tryPromise({
      try: () =>
        octokit.rest.pulls.list({
          owner,
          repo,
          state: 'closed',
          base,
          sort: 'updated',
          direction: 'desc',
          per_page: RECENT_CLOSED_PR_PAGE_SIZE,
        }),
      catch: asError,
    });
    return closed.data
      .filter((pr) => pr.merged_at !== null)
      .slice(0, RECENT_MERGED_PR_LIMIT)
      .map((pr) => pr.head.sha);
  });

/** The full K2 answer: the default branch's tip, then (only if the tip has no success) up to
 * `RECENT_MERGED_PR_LIMIT` recent merged PR heads, short-circuiting on the first success. `false`
 * only once every one of those has been checked and none reported — the case
 * `NeverReportedContext` exists to refuse. */
export const contextReportedSuccess = (
  octokit: OctokitClient,
  owner: string,
  repo: string,
  context: string,
): Effect.Effect<boolean, Error> =>
  Effect.gen(function* () {
    const repository = yield* Effect.tryPromise({
      try: () => octokit.rest.repos.get({ owner, repo }),
      catch: asError,
    });
    const ref = repository.data.default_branch;
    if (yield* hasRefReportedSuccess(octokit, owner, repo, ref, context)) return true;

    const heads = yield* recentMergedHeadShas(octokit, owner, repo, ref);
    for (const sha of heads) {
      if (yield* hasRefReportedSuccess(octokit, owner, repo, sha, context)) return true;
    }
    return false;
  });

export const makeRulesetOctokit = (baseUrl: string | undefined): RealRulesetOctokit => ({
  list: ({ owner, repo }) =>
    Effect.gen(function* () {
      const octokit = yield* octokitFor(baseUrl);
      const rulesets = yield* Effect.tryPromise({
        try: () =>
          octokit.paginate(octokit.rest.repos.getRepoRulesets, {
            owner,
            repo,
            includes_parents: false,
            per_page: 100,
          }),
        catch: asError,
      });
      return rulesets as RulesetSummary[];
    }),

  get: ({ owner, repo, rulesetId }) =>
    Effect.gen(function* () {
      const octokit = yield* octokitFor(baseUrl);
      return yield* Effect.tryPromise({
        try: () => octokit.rest.repos.getRepoRuleset({ owner, repo, ruleset_id: rulesetId }),
        catch: (e) => e,
      }).pipe(
        Effect.map(({ data }) => data as RulesetRecord),
        Effect.catchIf(is404, () => Effect.succeed(undefined)),
        Effect.mapError(asError),
      );
    }),

  create: (input: { owner: string; repo: string; body: CreateRulesetBody }) =>
    Effect.gen(function* () {
      const octokit = yield* octokitFor(baseUrl);
      const { data } = yield* Effect.tryPromise({
        try: () =>
          octokit.rest.repos.createRepoRuleset({
            owner: input.owner,
            repo: input.repo,
            ...input.body,
          }),
        catch: asError,
      });
      return data as RulesetRecord;
    }),

  update: (input: { owner: string; repo: string; rulesetId: number; body: CreateRulesetBody }) =>
    Effect.gen(function* () {
      const octokit = yield* octokitFor(baseUrl);
      const { data } = yield* Effect.tryPromise({
        try: () =>
          octokit.rest.repos.updateRepoRuleset({
            owner: input.owner,
            repo: input.repo,
            ruleset_id: input.rulesetId,
            ...input.body,
          }),
        catch: asError,
      });
      return data as RulesetRecord;
    }),

  delete: ({ owner, repo, rulesetId }) =>
    Effect.gen(function* () {
      const octokit = yield* octokitFor(baseUrl);
      yield* Effect.tryPromise({
        try: () => octokit.rest.repos.deleteRepoRuleset({ owner, repo, ruleset_id: rulesetId }),
        catch: (e) => e,
      }).pipe(
        Effect.asVoid,
        Effect.catchIf(is404, () => Effect.void),
        Effect.mapError(asError),
      );
    }),

  hasContextReportedSuccess: ({ owner, repo, context }) =>
    Effect.gen(function* () {
      const octokit = yield* octokitFor(baseUrl);
      return yield* contextReportedSuccess(octokit, owner, repo, context);
    }),
});
