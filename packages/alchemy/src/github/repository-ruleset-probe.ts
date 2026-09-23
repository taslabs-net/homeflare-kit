/**
 * The name-probe: how this resource finds a ruleset it has no prior state for, and the one
 * place `DuplicateRuleset` is raised. This is the fix for the hazard documented at the top of
 * repository-ruleset.ts — upstream's `Ruleset#reconcile` only ever looks up by the id in prior
 * `output`, so with none it calls `createRepoRuleset` unconditionally (measured in
 * `node_modules/alchemy/src/GitHub/Ruleset.ts`, `reconcile`).
 *
 * `RulesetOctokit` is a small injected seam (mirrors `PgExecutor` in `postgres/database-sql.ts`)
 * so the write-recording and GET-only fakes in the test files implement it directly — no HTTP
 * mocking needed for the resource's own logic. `repository-ruleset.ts` supplies the real
 * implementation, built from `octokitFor`/`GitHubCredentials` exactly as upstream's own
 * `getRuleset`/`createRepoRuleset` calls do.
 */
import * as Effect from 'effect/Effect';
import type { CreateRulesetBody } from './repository-ruleset-constraints.ts';
import { DuplicateRuleset } from './repository-ruleset-errors.ts';

// Every optional field spells out `| undefined` explicitly (not just `field?:`) so a fake or
// adapter built from a value that is itself `T | undefined` — the common shape once you have
// pulled a field off another object — can assign it directly under `exactOptionalPropertyTypes`
// without a conditional-spread dance at every call site.
export interface RulesetSummary {
  readonly id: number;
  readonly name: string;
  readonly target?: string | undefined;
  readonly source_type?: string | undefined;
}

export interface RulesetRecord extends RulesetSummary {
  readonly node_id?: string | undefined;
  readonly enforcement: string;
  readonly bypass_actors?: readonly Record<string, unknown>[] | undefined;
  readonly conditions?: unknown;
  readonly rules?: readonly Record<string, unknown>[] | undefined;
  readonly created_at?: string | undefined;
  readonly updated_at?: string | undefined;
}

/** Every method carries `Error` in its error channel, matching upstream `Ruleset.ts`'s own
 * `catch: (e) => e as Error` — a transport failure is not this resource's to type more
 * precisely than upstream types its own. `R` is the real adapter's ambient requirement
 * (`GitHubCredentials`, via `octokitFor` — see repository-ruleset-octokit.ts); test fakes need
 * none, so they satisfy `RulesetOctokit<never>` — the default — without carrying it. */
export interface RulesetOctokit<R = never> {
  /** Every ruleset owned directly by this repository (`includes_parents: false`, paginated) —
   * the list endpoint omits `bypass_actors`, so a match is always re-read by id. */
  readonly list: (input: {
    readonly owner: string;
    readonly repo: string;
  }) => Effect.Effect<readonly RulesetSummary[], Error, R>;
  /** `undefined` on a 404. */
  readonly get: (input: {
    readonly owner: string;
    readonly repo: string;
    readonly rulesetId: number;
  }) => Effect.Effect<RulesetRecord | undefined, Error, R>;
  readonly create: (input: {
    readonly owner: string;
    readonly repo: string;
    readonly body: CreateRulesetBody;
  }) => Effect.Effect<RulesetRecord, Error, R>;
  readonly update: (input: {
    readonly owner: string;
    readonly repo: string;
    readonly rulesetId: number;
    readonly body: CreateRulesetBody;
  }) => Effect.Effect<RulesetRecord, Error, R>;
  /** A 404 is success (S11: idempotent delete). */
  readonly delete: (input: {
    readonly owner: string;
    readonly repo: string;
    readonly rulesetId: number;
  }) => Effect.Effect<void, Error, R>;
  /** Whether `context` has ever reported success against the repository's default branch —
   * backs the `NeverReportedContext` guard. */
  readonly hasContextReportedSuccess: (input: {
    readonly owner: string;
    readonly repo: string;
    readonly context: string;
  }) => Effect.Effect<boolean, Error, R>;
}

/**
 * List + filter by name and target, then:
 * - 0 matches → `undefined` (a create is coming).
 * - 1 match → GET it by id (the list omits `bypass_actors`) and return the full record.
 * - `>1` → fail with `DuplicateRuleset`, naming every id, before reading any of them.
 */
export const probeByName = <R = never>(
  octokit: RulesetOctokit<R>,
  input: {
    readonly owner: string;
    readonly repo: string;
    readonly name: string;
    readonly target: string;
  },
): Effect.Effect<RulesetRecord | undefined, DuplicateRuleset | Error, R> =>
  Effect.gen(function* () {
    const all = yield* octokit.list({ owner: input.owner, repo: input.repo });
    const matches = all.filter(
      (r) => r.name === input.name && (r.target ?? 'branch') === input.target,
    );
    const [only, ...rest] = matches;
    if (only === undefined) return undefined;
    if (rest.length > 0) {
      return yield* Effect.fail(
        new DuplicateRuleset({
          owner: input.owner,
          repository: input.repo,
          name: input.name,
          ids: matches.map((m) => m.id),
        }),
      );
    }
    return yield* octokit.get({ owner: input.owner, repo: input.repo, rulesetId: only.id });
  });
