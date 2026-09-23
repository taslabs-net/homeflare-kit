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
 * ⚠️ "Reported success" is checked at the default branch's CURRENT TIP only, not its full
 *   history — a context that reported success three merges ago and has since started failing
 *   reads as reported (true), and one that has only ever run on a branch nobody has merged
 *   since reads as never-reported (false) until the next merge updates the tip. A full-history
 *   search is disproportionate to what this guard protects against (adding a context that
 *   plainly cannot report), and GitHub's check-runs/statuses APIs are themselves scoped to a
 *   single ref, not "ever, anywhere" — there is no cheaper vendor call that answers the wider
 *   question.
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
      const repository = yield* Effect.tryPromise({
        try: () => octokit.rest.repos.get({ owner, repo }),
        catch: asError,
      });
      const ref = repository.data.default_branch;
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
    }),
});
