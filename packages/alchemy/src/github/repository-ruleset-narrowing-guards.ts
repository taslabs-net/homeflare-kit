/**
 * Narrowing refusals — the counterpart to `bypassWideningRefusal`/`undeclaredLiveRuleRefusal` in
 * repository-ruleset-guards.ts, split into its own file purely to keep both under the 250-line
 * cap (same reason repository-ruleset-props.ts exists).
 *
 * ⛔ WIDENING STAYS UNCONDITIONAL; NARROWING GETS AN ESCAPE HATCH. Widening bypass (granting a
 *   NEW actor) has no legitimate reason to happen through a deploy — "grant it by hand and adopt
 *   the change" (repository-ruleset-errors.ts's `BypassActorWidened` message) already covers it,
 *   and this file does not touch that guard. NARROWING (removing a live bypass actor, or
 *   dropping a live rule) is different: it is exactly what an EXACT-ADOPT declaration of a repo
 *   whose live ruleset is narrower than the house baseline needs to express on its very first
 *   deploy — a caller declaring `taslabs-net/taslabs-net`'s live shape (measured live via `gh
 *   api repos/taslabs-net/taslabs-net/rulesets/12206080`, 2026-09-23: `bypass_actors:
 *   [{actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always"}]`, `rules: [deletion,
 *   non_fast_forward]`, no `pull_request` rule) is not narrowing anything by declaring exactly
 *   that shape — it is matching live exactly, and `reconcileRuleset`'s own noop check (comparing
 *   canonicalized wire forms) makes zero writes for it, same as any other exact match. What
 *   these guards refuse is a LATER declaration that removes something the CURRENT live state
 *   still has, without saying why. `acknowledgeBypassNarrowing`/`acknowledgeRuleNarrowing` are
 *   the "why": a reasoned, deliberate sign-off, not a rubber stamp — see their doc comments on
 *   `RepositoryRulesetProps` (repository-ruleset-props.ts).
 *
 * ⛔ THE TWO ACKNOWLEDGEMENTS ARE DELIBERATELY SEPARATE PROPS, NOT ONE SHARED FLAG (2026-09-23
 *   review finding). A single `acknowledgeNarrowing` computed once and handed to both guards let
 *   a reason written for one kind of narrowing silently also excuse the other — a declaration
 *   dropping BOTH a live rule and a live bypass actor at once needed only one acknowledgement,
 *   however narrowly worded, to pass both checks. Each guard below now reads its OWN prop.
 */
import { bypassKey, liveRuleTypes } from './repository-ruleset-guards.ts';
import { BypassActorNarrowed, RuleNarrowed } from './repository-ruleset-errors.ts';
import type { RepositoryRulesetProps, RepositoryRulesetRules } from './repository-ruleset-props.ts';
import type { RulesetRecord } from './repository-ruleset-probe.ts';

/** `true` only for a non-empty, non-whitespace `reason` on `acknowledgeBypassNarrowing` — a bare
 * `{}` or a blank string is not an acknowledgement (repository-ruleset.ts's `constraintRefusal`
 * refuses the latter at plan time; this is the read `bypassNarrowingRefusal` shares). Deliberately
 * ignorant of `acknowledgeRuleNarrowing` — see the file header. */
export const isBypassNarrowingAcknowledged = (props: RepositoryRulesetProps): boolean =>
  props.acknowledgeBypassNarrowing !== undefined &&
  props.acknowledgeBypassNarrowing.reason.trim().length > 0;

/** The `rules`-side counterpart to `isBypassNarrowingAcknowledged`, reading only
 * `acknowledgeRuleNarrowing` — see the file header. */
export const isRuleNarrowingAcknowledged = (props: RepositoryRulesetProps): boolean =>
  props.acknowledgeRuleNarrowing !== undefined &&
  props.acknowledgeRuleNarrowing.reason.trim().length > 0;

/**
 * A live bypass actor the declaration drops, unacknowledged. `undefined` `declared` never
 * reaches here — same rule as `bypassWideningRefusal`: unmanaged means the live value is
 * preserved unchanged (repository-ruleset-reconcile.ts), so there is nothing to narrow.
 */
export function bypassNarrowingRefusal(input: {
  readonly owner: string;
  readonly repository: string;
  readonly name: string;
  readonly declared: RepositoryRulesetProps['bypassActors'];
  readonly live: RulesetRecord | undefined;
  readonly acknowledged: boolean;
}): BypassActorNarrowed | undefined {
  if (input.acknowledged) return undefined;
  if (input.live === undefined) return undefined;
  const liveActors = (input.live.bypass_actors ?? []) as {
    actor_type: unknown;
    actor_id: unknown;
    bypass_mode?: unknown;
  }[];
  const declaredKeys = new Set(
    (input.declared ?? []).map((a) =>
      bypassKey({
        actor_type: a.actorType,
        actor_id: a.actorId,
        bypass_mode: a.bypassMode ?? 'always',
      }),
    ),
  );
  const narrowed = liveActors.map(bypassKey).filter((k) => !declaredKeys.has(k));
  if (narrowed.length === 0) return undefined;
  return new BypassActorNarrowed({
    owner: input.owner,
    repository: input.repository,
    name: input.name,
    narrowed,
  });
}

/** The live rule `type` for the first boolean/`pullRequest` rule the declaration marks `false`
 * while live still has it — `undefined` when none does. `requiredStatusChecks: false` is
 * checked by the caller directly (its live-side read needs `required_status_checks`'s own
 * parameters shape, not just presence, elsewhere in this family — kept out of this helper so it
 * stays a plain type-to-type comparison). */
function droppedBooleanOrPullRequestType(
  rules: RepositoryRulesetRules,
  live: ReadonlySet<string>,
): string | undefined {
  const declaredFalse: readonly [boolean | undefined, string][] = [
    [rules.creation, 'creation'],
    [rules.update, 'update'],
    [rules.deletion, 'deletion'],
    [rules.requiredLinearHistory, 'required_linear_history'],
    [rules.requiredSignatures, 'required_signatures'],
    [rules.nonFastForward, 'non_fast_forward'],
  ];
  for (const [declared, type] of declaredFalse) {
    if (declared === false && live.has(type)) return type;
  }
  if (rules.pullRequest === false && live.has('pull_request')) return 'pull_request';
  return undefined;
}

/**
 * A rule the declaration explicitly marks absent (a boolean rule or `pullRequest` declared
 * `false`, or `requiredStatusChecks: false`) while the LIVE ruleset still has it, unacknowledged
 * — the drop `undeclaredLiveRuleRefusal` (repository-ruleset-guards.ts) never sees, because an
 * explicit `false` IS "declared" there (see its own `declaredRuleTypes`).
 */
export function ruleNarrowingRefusal(input: {
  readonly owner: string;
  readonly repository: string;
  readonly name: string;
  readonly declared: RepositoryRulesetProps['rules'];
  readonly live: RulesetRecord | undefined;
  readonly acknowledged: boolean;
}): RuleNarrowed | undefined {
  if (input.acknowledged) return undefined;
  const rules = input.declared;
  if (rules === undefined) return undefined;
  const live = liveRuleTypes(input.live);
  const ruleType =
    droppedBooleanOrPullRequestType(rules, live) ??
    (rules.requiredStatusChecks === false && live.has('required_status_checks')
      ? 'required_status_checks'
      : undefined);
  if (ruleType === undefined) return undefined;
  return new RuleNarrowed({
    owner: input.owner,
    repository: input.repository,
    name: input.name,
    ruleType,
  });
}
