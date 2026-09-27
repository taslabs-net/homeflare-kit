/**
 * The warning `Grafana.AlertRuleGroup` logs when a whole-group PUT would silently drop a live rule
 * the declaration never mentions — flagged by an adversarial review of this PR: a human adding a
 * rule in the Grafana UI minutes before a deploy (ordinary, writable provenance — nothing foreign
 * to refuse on) would otherwise be removed with no visible reason, `diff` only ever saying
 * "update". `Grafana.AlertRuleGroup` is still the group as the unit BY DESIGN (that file's own
 * header) — this does not refuse the write, only makes the loss visible.
 *
 * ★ `Effect.logWarning`, NEVER A REFUSAL — mirrors the house pattern `proxmox/unreadable-read.ts`'s
 *   `unreadableWarning` established. Alchemy's `Diff` type is exactly `NoopDiff | UpdateDiff |
 *   ReplaceDiff` (no fourth action to carry "update, but lossy" through to `bun run plan`'s printed
 *   action), and refusing here would contradict "the group is the unit": a whole-group replacement
 *   dropping an out-of-band rule is EXPECTED behavior for this resource, not an error condition —
 *   only a silent one worth surfacing loudly.
 *
 * ★ NO IMPORT OF `AlertRuleGroupProps` — deliberately primitive arguments (`folderUid`/`group`/a
 *   plain `Set` of declared uids) rather than the whole props object, so this file has no
 *   dependency back on `alert-rule-group.ts` and can be unit-tested with plain data.
 */
import * as Effect from 'effect/Effect';

export const warnOnDroppedRules = (
  folderUid: string,
  group: string,
  declaredUids: ReadonlySet<string>,
  liveRules: ReadonlyArray<{ readonly uid?: unknown; readonly title?: unknown }> | undefined,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const dropped = (liveRules ?? [])
      .filter((rule): rule is { title?: unknown; uid: string } => typeof rule.uid === 'string')
      .filter((rule) => !declaredUids.has(rule.uid));
    if (dropped.length === 0) return;
    const names = dropped
      .map((rule) => `${typeof rule.title === 'string' ? rule.title : '(untitled)'} (${rule.uid})`)
      .join(', ');
    yield* Effect.logWarning(
      `Grafana.AlertRuleGroup ${folderUid}/${group}: this update REMOVES ${dropped.length} ` +
        `rule(s) not in the declaration: ${names}. Whole-group replacement is by design — add ` +
        `them to the declaration to keep them, or give them their own group.`,
    );
  });
