/**
 * Release.Binary's plan-time answer: refuse what the plan can already see is wrong, `replace` when
 * the binary's identity moves, and otherwise compare the live file with the declaration.
 *
 * ⛔ THE PINS MUST BE PLAIN VALUES, AND ARE CHECKED EVEN WHILE `directory` IS AN OUTPUT. A pin that
 *   is an Output would be computed during the deploy — a fetch by another name — so a malformed or
 *   non-literal pin fails the plan here, before a byte is fetched, whatever else is unresolved.
 *   ⚠️ A CREATE IS NEVER DIFFED: the engine plans a first deploy without calling diff, and skips
 *   the adoption probe while any prop is an Output. A pin wired from another resource's Output on
 *   a FIRST deploy therefore reaches no plan-time check; reconcile refuses it before any host call
 *   or request, from the props as the stack program declared them (declared-pins.ts). 🔴 Until
 *   2026-09-22 it was checked there for shape only, and a swapped archive with swapped digests
 *   installed (apply-pins.test.ts).
 * ⛔ A NEW PIN IS A NEW PATH (binary-form.ts inPlaceRefusal). When the path is resolved and
 *   unchanged, a changed pin is refused here; when it is resolved and new, it is a `replace`.
 * ⚠️ WHILE THE DIRECTORY IS STILL AN OUTPUT the path is unknown, and the answer depends on whether
 *   the BYTES move, because the path may turn out not to have:
 *   - other bytes (or another name) → `replace`. If the path did not move after all, the new
 *     generation's create finds the old file, which does not hold its bytes, and refuses
 *     (file-converge.ts never overwrites what a generation does not own).
 *   - the same bytes from another archive (a re-pin, a repack) → `update`, NEVER `replace`. 🔴 A
 *     replace onto the same path would accept the old file as its own (same bytes, same mode) and
 *     then Phase 2 would delete the OLD generation — at that same path, taking the new one's file
 *     with it. An update reaches reconcile with `olds`, whose in-place guard refuses the same path,
 *     and whose move (file-converge.ts) writes the new path before removing the old.
 *   ★ Not the engine's default either way: a changed prop is an update by default, which is
 *   exactly the in-place overwrite this resource refuses.
 * ★ Create-before-delete: two versions can sit in two directories at once, so nothing forces
 *   `deleteFirst`; the old file goes only once the new one is written and verified.
 * ⚠️ HOUSE, NOT UPSTREAM: this reads the live file at plan time and can answer `noop`. Upstream's
 *   guidance is a diff that rarely does either (docs/release-binary-upstream.md).
 */
import { type Diff, isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { diffTarget } from '../launchd/file-converge.ts';
import { resolvedString } from '../launchd/host-effect.ts';
import type { HostRunner } from '../launchd/runner.ts';
import { adoptionProblem } from './binary-claim.ts';
import {
  type ReleaseBinaryAttributes,
  type ReleaseBinaryProps,
  inPlaceRefusal,
  pinProblems,
  pinsMoved,
} from './binary-form.ts';
import { NOTHING, desiredBinary, refuse } from './binary-lifecycle.ts';

export const diffBinary = async (
  runner: HostRunner,
  news: Input<ReleaseBinaryProps>,
  olds: ReleaseBinaryProps,
  output: ReleaseBinaryAttributes,
): Promise<Diff | undefined> => {
  const problems = pinProblems((news ?? {}) as Parameters<typeof pinProblems>[0]);
  if (problems.length > 0) throw refuse(output.path, `${problems.join('; ')}. ${NOTHING}`);
  // ⛔ A TAKEOVER IS ONLY EVER OF THE PINNED BINARY (binary-claim.ts): `output` here is a read of a
  //   path with no state, so the plan refuses what it would otherwise print as `adopted`.
  const takeover = adoptionProblem(output.sha256, olds.sha256);
  if (takeover !== undefined) throw refuse(output.path, `${takeover}. ${NOTHING}`);
  // ★ pinProblems passed, so every pin — and `name` — is a plain value; only these are read below.
  const pins = news as Pick<ReleaseBinaryProps, 'archive' | 'member' | 'sha256' | 'name'>;
  const directory = resolvedString(news, 'directory');
  const path = directory === undefined ? undefined : `${directory}/${pins.name}`;
  const pinned = pinsMoved(olds, pins);
  if (pinned && path === output.path) {
    throw refuse(output.path, `${inPlaceRefusal(olds, pins)}. ${NOTHING}`);
  }
  // Resolved: a new path is a replace, other bytes or a mode or owner drift an update (diffTarget).
  if (isResolved(news)) return diffTarget(runner, (await desiredBinary(runner, news)).want, output);
  if (path !== undefined) return path === output.path ? undefined : { action: 'replace' };
  if (pins.name !== olds.name || pins.sha256 !== olds.sha256) return { action: 'replace' };
  return pinned ? { action: 'update' } : undefined;
};
