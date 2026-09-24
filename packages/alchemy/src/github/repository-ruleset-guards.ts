/**
 * Everything `reconcile` refuses before it writes, and why. Extracted so
 * repository-ruleset.ts stays the wiring, and the reasoning stays whole — the same split
 * `repo-policy-guards.ts` uses for `declareRepoPolicy`.
 */
import * as Effect from 'effect/Effect';
import type { RepositoryRulesetProps } from './repository-ruleset.ts';
import { RULE_TYPE_COVERAGE, type RepositoryRuleType } from './repository-ruleset-constraints.ts';
import {
  BypassActorWidened,
  NeverReportedContext,
  RequiredChecksOmitted,
  UndeclaredLiveRule,
} from './repository-ruleset-errors.ts';
import type { RulesetOctokit, RulesetRecord } from './repository-ruleset-probe.ts';

/** Exported: repository-ruleset-narrowing-guards.ts reuses the identical key so a widened and a
 * narrowed actor are never computed by two independently-drifting definitions of "the same
 * actor". */
export const bypassKey = (a: { actor_type: unknown; actor_id: unknown; bypass_mode?: unknown }) =>
  `${String(a.actor_type)}:${String(a.actor_id ?? '')}:${String(a.bypass_mode ?? 'always')}`;

/**
 * ⛔ A CREATE REQUIRES `[]`; `undefined` on a create is the same thing (nothing live to widen
 *   from). On an update/adopt, `undefined` means unmanaged — the caller never sees this guard
 *   because repository-ruleset.ts sends the LIVE value back unchanged in that case, and this
 *   function is only called when `props.bypassActors` is explicitly declared.
 */
export function bypassWideningRefusal(input: {
  readonly owner: string;
  readonly repository: string;
  readonly name: string;
  readonly declared: RepositoryRulesetProps['bypassActors'];
  readonly live: RulesetRecord | undefined;
}): BypassActorWidened | undefined {
  // A create may declare any bypass list — nothing live to widen against.
  if (input.live === undefined) return undefined;
  const liveActors = (input.live.bypass_actors ?? []) as {
    actor_type: unknown;
    actor_id: unknown;
    bypass_mode?: unknown;
  }[];
  const liveKeys = new Set(liveActors.map(bypassKey));
  const widened = (input.declared ?? [])
    .map((a) =>
      bypassKey({
        actor_type: a.actorType,
        actor_id: a.actorId,
        bypass_mode: a.bypassMode ?? 'always',
      }),
    )
    .filter((k) => !liveKeys.has(k));
  if (widened.length === 0) return undefined;
  return new BypassActorWidened({
    owner: input.owner,
    repository: input.repository,
    name: input.name,
    widened,
  });
}

/** Exported for the same reason as `bypassKey` — repository-ruleset-narrowing-guards.ts's
 * `ruleNarrowingRefusal` needs the identical live-type set `undeclaredLiveRuleRefusal` computes,
 * not a second reading of `live.rules` that could disagree with this one. */
export const liveRuleTypes = (live: RulesetRecord | undefined): Set<string> =>
  new Set((live?.rules ?? []).map((r) => String(r.type)));

/**
 * Refuses (a) any live rule of a REFUSED type — this resource can never represent it, and the
 * PUT replaces `rules` wholesale, so silence would drop it; and (b) ANY live rule of a MODELED
 * type the declaration is silent about — same hazard, for every rule this resource owns.
 *
 * ⚠️ `declaredTypes` MUST BE PRESENCE, NOT TRUTHINESS — this is the fix for a real bug this
 *   family's own design first shipped with. A plain `rules?.deletion` check cannot distinguish
 *   "omitted" from "declared `false`", so `undeclaredLiveRuleRefusal` originally exempted every
 *   boolean rule (`creation`/`update`/`deletion`/`requiredLinearHistory`/`requiredSignatures`/
 *   `nonFastForward`) as "fully owned — omission IS the removal". Concretely, that meant: a
 *   live ruleset has `deletion: true` (blocks branch deletion); a caller declares this resource
 *   with `rules: { pullRequest: {...}, requiredStatusChecks: {...} }`, simply forgetting
 *   `deletion: true` — an easy mistake, since omitting an optional boolean is not a type error.
 *   The wholesale PUT would have sent `rules` without a `deletion` entry, silently REMOVING
 *   branch-deletion protection on the very next `reconcile` — exactly the hazard this whole
 *   guard exists to prevent, reached through the one door it left open. Found by a self-review
 *   pass (no subagent available in this harness), not by a test; there is now one:
 *   repository-ruleset-write-refusals.test.ts's "an omitted boolean rule" case.
 *   `required_status_checks` still gets its own, better-worded `RequiredChecksOmitted` from
 *   {@link requiredChecksOmissionRefusal} and is excluded here so it is not refused twice.
 */
export function undeclaredLiveRuleRefusal(input: {
  readonly owner: string;
  readonly repository: string;
  readonly name: string;
  readonly live: RulesetRecord | undefined;
  readonly declaredTypes: ReadonlySet<string>;
}): UndeclaredLiveRule | undefined {
  for (const type of liveRuleTypes(input.live)) {
    const coverage = RULE_TYPE_COVERAGE[type as RepositoryRuleType];
    if (coverage === 'refused') {
      return new UndeclaredLiveRule({
        owner: input.owner,
        repository: input.repository,
        name: input.name,
        ruleType: type,
      });
    }
    if (
      coverage === 'modeled' &&
      type !== 'required_status_checks' &&
      !input.declaredTypes.has(type)
    ) {
      return new UndeclaredLiveRule({
        owner: input.owner,
        repository: input.repository,
        name: input.name,
        ruleType: type,
      });
    }
  }
  return undefined;
}

/** The wire `type` for every rule key present ON THE DECLARATION OBJECT ITSELF — `Object.hasOwn`,
 * not truthiness, so `{ deletion: false }` (an explicit, deliberate removal) counts as declared
 * and a bare omission does not. Feeds `undeclaredLiveRuleRefusal`'s `declaredTypes`. */
export function declaredRuleTypes(rules: RepositoryRulesetProps['rules']): ReadonlySet<string> {
  if (rules === undefined) return new Set();
  const BOOLEAN_KEY_TO_TYPE: Record<string, string> = {
    creation: 'creation',
    update: 'update',
    deletion: 'deletion',
    requiredLinearHistory: 'required_linear_history',
    requiredSignatures: 'required_signatures',
    nonFastForward: 'non_fast_forward',
  };
  const types = new Set<string>();
  for (const [key, type] of Object.entries(BOOLEAN_KEY_TO_TYPE)) {
    if (Object.hasOwn(rules, key)) types.add(type);
  }
  if (Object.hasOwn(rules, 'pullRequest')) types.add('pull_request');
  return types;
}

/** `requiredStatusChecks: undefined` while the live ruleset HAS one → refused, naming the live
 * contexts. `requiredStatusChecks: false` is the declared removal and never reaches here. */
export function requiredChecksOmissionRefusal(input: {
  readonly owner: string;
  readonly repository: string;
  readonly name: string;
  readonly declared: RepositoryRulesetProps['rules'];
  readonly live: RulesetRecord | undefined;
}): RequiredChecksOmitted | undefined {
  if (input.declared?.requiredStatusChecks !== undefined) return undefined;
  const liveRule = (input.live?.rules ?? []).find((r) => r.type === 'required_status_checks');
  if (liveRule === undefined) return undefined;
  const params = liveRule.parameters as
    | { required_status_checks?: { context: string }[] }
    | undefined;
  const liveContexts = (params?.required_status_checks ?? []).map((c) => c.context);
  return new RequiredChecksOmitted({
    owner: input.owner,
    repository: input.repository,
    name: input.name,
    liveContexts,
  });
}

/** Every context in the declared `requiredStatusChecks` that the LIVE ruleset does not already
 * require — i.e. being added by this plan, the only case a never-reported context can matter. */
export const newlyRequiredContexts = (
  declared: RepositoryRulesetProps['rules'],
  live: RulesetRecord | undefined,
): readonly string[] => {
  if (declared?.requiredStatusChecks === false || declared?.requiredStatusChecks === undefined)
    return [];
  const liveRule = (live?.rules ?? []).find((r) => r.type === 'required_status_checks');
  const liveParams = liveRule?.parameters as
    | { required_status_checks?: { context: string }[] }
    | undefined;
  const liveContexts = new Set((liveParams?.required_status_checks ?? []).map((c) => c.context));
  return declared.requiredStatusChecks.checks
    .map((c) => c.context)
    .filter((c) => !liveContexts.has(c));
};

/** Fails on the first newly-required context that has never reported success on the default
 * branch — checked once here (reconcile's observe step) and again by the standalone checker. */
export const refuseUnreportedContexts = <R = never>(
  octokit: RulesetOctokit<R>,
  owner: string,
  repo: string,
  contexts: readonly string[],
): Effect.Effect<void, NeverReportedContext | Error, R> =>
  Effect.gen(function* () {
    for (const context of contexts) {
      const reported = yield* octokit.hasContextReportedSuccess({ owner, repo, context });
      if (!reported) {
        return yield* Effect.fail(new NeverReportedContext({ owner, repository: repo, context }));
      }
    }
  });
