/**
 * `reconcile`'s body, apart from repository-ruleset.ts so the wiring there stays readable.
 * One flow (S9): observe, then every plan-time and live-data refusal, then write only on
 * drift (S10 — a matching noop makes zero calls), then an INDEPENDENT readback.
 */
import * as Effect from 'effect/Effect';
import type { RepositoryRulesetAttributes, RepositoryRulesetProps } from './repository-ruleset.ts';
import type { CreateRulesetBody } from './repository-ruleset-constraints.ts';
import {
  ReadbackMismatch,
  type RepositoryRulesetError,
  type RulesetConstraintRefused,
} from './repository-ruleset-errors.ts';
import { canonicalizeWireRuleset, desiredWireRuleset } from './repository-ruleset-form.ts';
import {
  bypassWideningRefusal,
  declaredRuleTypes,
  newlyRequiredContexts,
  refuseUnreportedContexts,
  requiredChecksOmissionRefusal,
  undeclaredLiveRuleRefusal,
} from './repository-ruleset-guards.ts';
import {
  bypassNarrowingRefusal,
  isBypassNarrowingAcknowledged,
  isRuleNarrowingAcknowledged,
  ruleNarrowingRefusal,
} from './repository-ruleset-narrowing-guards.ts';
import {
  type RulesetOctokit,
  type RulesetRecord,
  probeByName,
} from './repository-ruleset-probe.ts';

const guardedPullRequestFields = (
  rule: Record<string, unknown> | undefined,
): Record<string, unknown> => {
  const params = (rule?.parameters ?? {}) as Record<string, unknown>;
  return {
    required_approving_review_count: params.required_approving_review_count,
    allowed_merge_methods: Array.isArray(params.allowed_merge_methods)
      ? [...(params.allowed_merge_methods as string[])].sort()
      : undefined,
    require_extra_approval_for_unattributed_changes:
      params.require_extra_approval_for_unattributed_changes,
  };
};

/** Compares only the fields this resource exists to guarantee (H15's extension flag,
 * `allowedMergeMethods`, the approval count) between what was SENT and an INDEPENDENT re-read —
 * never the write response itself (S10). */
function readbackRefusal(
  owner: string,
  repository: string,
  name: string,
  sentRules: readonly Record<string, unknown>[],
  independent: RulesetRecord,
): ReadbackMismatch | undefined {
  const sentPr = sentRules.find((r) => r.type === 'pull_request');
  if (sentPr === undefined) return undefined;
  const readPr = (independent.rules ?? []).find((r) => r.type === 'pull_request');
  const sent = guardedPullRequestFields(sentPr);
  const read = guardedPullRequestFields(readPr);
  for (const field of Object.keys(sent) as (keyof typeof sent)[]) {
    if (sent[field] === undefined) continue;
    if (JSON.stringify(sent[field]) !== JSON.stringify(read[field])) {
      return new ReadbackMismatch({
        owner,
        repository,
        name,
        field: `rules.pull_request.parameters.${field}`,
        sent: sent[field],
        read: read[field],
      });
    }
  }
  return undefined;
}

/**
 * `octokit` is INJECTED, never constructed in here — the real adapter comes from
 * repository-ruleset.ts (`makeRulesetOctokit(news.baseUrl)`), and the write-recording and
 * GET-only fakes in the test files pass their own. Nothing about the flow below depends on
 * which one it is, which is the whole point of the seam (mirrors `reconcileWithClient(pg, …)`
 * in postgres/database.ts taking its `PgExecutor` the same way).
 */
export const reconcileRuleset = <R = never>(input: {
  readonly octokit: RulesetOctokit<R>;
  readonly news: RepositoryRulesetProps;
  readonly output: RepositoryRulesetAttributes | undefined;
  readonly constraintRefusal: (
    props: RepositoryRulesetProps,
  ) => RulesetConstraintRefused | undefined;
  readonly attrsOf: (r: RulesetRecord) => RepositoryRulesetAttributes;
}): Effect.Effect<RepositoryRulesetAttributes, RepositoryRulesetError | Error, R> =>
  Effect.gen(function* () {
    const { news, output, constraintRefusal, attrsOf, octokit } = input;
    const refusal = constraintRefusal(news);
    if (refusal !== undefined) return yield* Effect.fail(refusal);

    const owner = news.owner;
    const repo = news.repository;
    const target = news.target ?? 'branch';

    let observed: RulesetRecord | undefined =
      output === undefined
        ? undefined
        : yield* octokit.get({ owner, repo, rulesetId: output.rulesetId });
    if (observed === undefined) {
      observed = yield* probeByName(octokit, { owner, repo, name: news.name, target });
    }

    // Deliberately TWO separate reads, not one shared flag — each guard below is authorized
    // only by the acknowledgement scoped to what it checks (see the file header on
    // repository-ruleset-narrowing-guards.ts for the 2026-09-23 finding this fixes).
    const bypassAcknowledged = isBypassNarrowingAcknowledged(news);
    const ruleAcknowledged = isRuleNarrowingAcknowledged(news);

    const bypassRefusal =
      news.bypassActors === undefined
        ? undefined
        : bypassWideningRefusal({
            owner,
            repository: repo,
            name: news.name,
            declared: news.bypassActors,
            live: observed,
          });
    if (bypassRefusal !== undefined) return yield* Effect.fail(bypassRefusal);

    const bypassNarrowRefusal =
      news.bypassActors === undefined
        ? undefined
        : bypassNarrowingRefusal({
            owner,
            repository: repo,
            name: news.name,
            declared: news.bypassActors,
            live: observed,
            acknowledged: bypassAcknowledged,
          });
    if (bypassNarrowRefusal !== undefined) return yield* Effect.fail(bypassNarrowRefusal);

    const ruleRefusal = undeclaredLiveRuleRefusal({
      owner,
      repository: repo,
      name: news.name,
      live: observed,
      declaredTypes: declaredRuleTypes(news.rules),
    });
    if (ruleRefusal !== undefined) return yield* Effect.fail(ruleRefusal);

    const ruleNarrowRefusal = ruleNarrowingRefusal({
      owner,
      repository: repo,
      name: news.name,
      declared: news.rules,
      live: observed,
      acknowledged: ruleAcknowledged,
    });
    if (ruleNarrowRefusal !== undefined) return yield* Effect.fail(ruleNarrowRefusal);

    const checksRefusal = requiredChecksOmissionRefusal({
      owner,
      repository: repo,
      name: news.name,
      declared: news.rules,
      live: observed,
    });
    if (checksRefusal !== undefined) return yield* Effect.fail(checksRefusal);

    const newContexts = newlyRequiredContexts(news.rules, observed);
    yield* refuseUnreportedContexts(octokit, owner, repo, newContexts);

    const desired = desiredWireRuleset(news);
    // `undefined` means unmanaged: the live value is sent back unchanged rather than the `[]`
    // `desiredWireRuleset` defaults to. On a create there is nothing live to carry forward, so
    // `[]` (already inside `desired`) is correct there too.
    const body: CreateRulesetBody =
      news.bypassActors === undefined && observed !== undefined
        ? ({ ...desired, bypass_actors: observed.bypass_actors ?? [] } as CreateRulesetBody)
        : desired;

    let record: RulesetRecord;
    let wrote = false;
    if (observed === undefined) {
      record = yield* octokit.create({ owner, repo, body });
      wrote = true;
    } else {
      const same =
        JSON.stringify(canonicalizeWireRuleset(body)) ===
        JSON.stringify(canonicalizeWireRuleset(observed));
      if (same) {
        record = observed;
      } else {
        record = yield* octokit.update({ owner, repo, rulesetId: observed.id, body });
        wrote = true;
      }
    }

    if (wrote) {
      const independent = yield* octokit.get({ owner, repo, rulesetId: record.id });
      if (independent !== undefined) {
        const sentRules = (body.rules ?? []) as unknown as Record<string, unknown>[];
        const mismatch = readbackRefusal(owner, repo, news.name, sentRules, independent);
        if (mismatch !== undefined) return yield* Effect.fail(mismatch);
      }
    }

    return attrsOf(record);
  });
