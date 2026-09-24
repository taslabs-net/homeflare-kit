/**
 * `GitHub.RepositoryRuleset`'s failures as typed tags (S21). None of these sniffs a status
 * code or matches a message from Octokit — every one is raised from a fact this family's own
 * code already checked (a paginated list, a live GET, a declared prop), so `catchTag` covers
 * every refusal without a driver-string coincidence hiding a different failure underneath it.
 */
import * as Data from 'effect/Data';

/**
 * More than one ruleset shares a name (and target) on the same repository. `probeByName`
 * fails BEFORE reading either one — see repository-ruleset-probe.ts — because there is no
 * way to know which one is "ours" and guessing risks converging the wrong ruleset.
 */
export class DuplicateRuleset extends Data.TaggedError('DuplicateRuleset')<{
  readonly owner: string;
  readonly repository: string;
  readonly name: string;
  readonly ids: readonly number[];
}> {
  override get message(): string {
    return (
      `GitHub.RepositoryRuleset: ${this.owner}/${this.repository} has ${String(this.ids.length)} ` +
      `rulesets named "${this.name}" (ids ${this.ids.join(', ')}). Delete the extra one or rename ` +
      'it by hand before this resource can adopt or manage it — nothing was read or written.'
    );
  }
}

/** A declared `bypassActors` entry names an actor the live ruleset does not have. Widening
 * bypass is a handoff, never a deploy — see repository-ruleset-guards.ts. */
export class BypassActorWidened extends Data.TaggedError('BypassActorWidened')<{
  readonly owner: string;
  readonly repository: string;
  readonly name: string;
  readonly widened: readonly string[];
}> {
  override get message(): string {
    return (
      `GitHub.RepositoryRuleset "${this.name}" on ${this.owner}/${this.repository}: the ` +
      `declaration adds a bypass actor the live ruleset does not have (${this.widened.join(', ')}). ` +
      'Widening bypass is refused here; grant it by hand and adopt the change, or use handoff.'
    );
  }
}

/** A declared `bypassActors` drops an actor the live ruleset has, with no
 * `acknowledgeBypassNarrowing` on the declaration. Unlike widening, narrowing is not always
 * wrong — an exact-adopt declaration that matches live exactly narrows nothing — so this is
 * refused only when live genuinely has more than the declaration keeps, and it is escapable
 * (`BypassActorWidened` is not): see `bypassNarrowingRefusal` in
 * repository-ruleset-narrowing-guards.ts. */
export class BypassActorNarrowed extends Data.TaggedError('BypassActorNarrowed')<{
  readonly owner: string;
  readonly repository: string;
  readonly name: string;
  readonly narrowed: readonly string[];
}> {
  override get message(): string {
    return (
      `GitHub.RepositoryRuleset "${this.name}" on ${this.owner}/${this.repository}: the ` +
      `declaration drops a bypass actor the live ruleset has (${this.narrowed.join(', ')}), and ` +
      'the declaration carries no `acknowledgeBypassNarrowing`. Add one with a reason once the ' +
      'removal is deliberate, or restore the actor to match live.'
    );
  }
}

/** A rule type the declaration explicitly marks absent (`false`) while the live ruleset still
 * has it, with no `acknowledgeRuleNarrowing` on the declaration — see `ruleNarrowingRefusal` in
 * repository-ruleset-narrowing-guards.ts. Distinct from `UndeclaredLiveRule`: that one fires on
 * SILENCE (the declaration says nothing); this one fires on an EXPLICIT, but unacknowledged,
 * removal. */
export class RuleNarrowed extends Data.TaggedError('RuleNarrowed')<{
  readonly owner: string;
  readonly repository: string;
  readonly name: string;
  readonly ruleType: string;
}> {
  override get message(): string {
    return (
      `GitHub.RepositoryRuleset "${this.name}" on ${this.owner}/${this.repository}: the ` +
      `declaration drops a live "${this.ruleType}" rule, and carries no ` +
      '`acknowledgeRuleNarrowing`. Add one with a reason once the removal is deliberate, or ' +
      'declare the rule to match live.'
    );
  }
}

/** A live rule's `type` is neither modeled nor explicitly refused by RULE_TYPE_COVERAGE, or is
 * refused and present live anyway. The PUT replaces `rules` wholesale, so silently omitting a
 * live rule type would drop it — this fails the plan by name instead. */
export class UndeclaredLiveRule extends Data.TaggedError('UndeclaredLiveRule')<{
  readonly owner: string;
  readonly repository: string;
  readonly name: string;
  readonly ruleType: string;
}> {
  override get message(): string {
    return (
      `GitHub.RepositoryRuleset "${this.name}" on ${this.owner}/${this.repository}: the live ` +
      `ruleset has a "${this.ruleType}" rule this resource does not model. Declare it (if it is ` +
      'now modeled) or an explicit `false` to remove it — the PUT replaces `rules` wholesale, so ' +
      'nothing may be dropped silently.'
    );
  }
}

/** The declaration omits `requiredStatusChecks` while adopting or updating a live ruleset that
 * HAS one. Declare the contexts, or declare `requiredStatusChecks: false` to remove them. */
export class RequiredChecksOmitted extends Data.TaggedError('RequiredChecksOmitted')<{
  readonly owner: string;
  readonly repository: string;
  readonly name: string;
  readonly liveContexts: readonly string[];
}> {
  override get message(): string {
    return (
      `GitHub.RepositoryRuleset "${this.name}" on ${this.owner}/${this.repository}: the live ` +
      `ruleset requires ${this.liveContexts.join(', ')}, and the declaration says nothing about ` +
      'requiredStatusChecks. Declare the same contexts, or `rules.requiredStatusChecks: false` to ' +
      'remove them on purpose.'
    );
  }
}

/** A context being ADDED to `requiredStatusChecks` has never reported success anywhere this
 * family looks (the default branch's tip, then recent merged PR heads — K2, bounded, not full
 * history). Requiring it would leave every future pull request pending forever. */
export class NeverReportedContext extends Data.TaggedError('NeverReportedContext')<{
  readonly owner: string;
  readonly repository: string;
  readonly context: string;
}> {
  override get message(): string {
    return (
      `GitHub.RepositoryRuleset: "${this.context}" has never reported success on ` +
      `${this.owner}/${this.repository}'s default branch tip or any of its recent merged pull ` +
      'requests. Requiring it now would leave every pull request waiting on a check that has ' +
      'never once reported — refused before any write.'
    );
  }
}

/** A prop value the wire form or GitHub's own schema refuses — an approval count outside 0–10,
 * an empty `allowedMergeMethods`, or an unmodeled rule `type` in the declaration itself. */
export class RulesetConstraintRefused extends Data.TaggedError('RulesetConstraintRefused')<{
  readonly field: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `GitHub.RepositoryRuleset: ${this.field} — ${this.reason}`;
  }
}

/** The independent readback GET after a write does not match what was sent, for one of the
 * fields this family refuses to leave unverified (S10: the write's own report is never proof). */
export class ReadbackMismatch extends Data.TaggedError('ReadbackMismatch')<{
  readonly owner: string;
  readonly repository: string;
  readonly name: string;
  readonly field: string;
  readonly sent: unknown;
  readonly read: unknown;
}> {
  override get message(): string {
    return (
      `GitHub.RepositoryRuleset "${this.name}" on ${this.owner}/${this.repository}: after the ` +
      `write, an independent GET of ${this.field} read back ${JSON.stringify(this.read)}, not the ` +
      `${JSON.stringify(this.sent)} that was sent. The write did not persist as declared.`
    );
  }
}

export type RepositoryRulesetError =
  | DuplicateRuleset
  | BypassActorWidened
  | BypassActorNarrowed
  | UndeclaredLiveRule
  | RuleNarrowed
  | RequiredChecksOmitted
  | NeverReportedContext
  | RulesetConstraintRefused
  | ReadbackMismatch;
