/**
 * Comparison logic between a live `ACL LIST` line and the declaration: whether a user matches,
 * what profile its rules were recognised as, and set equality over the token lists.
 *
 * Extracted from `acl-form.ts` (which owns building and parsing) to keep both files under the cap;
 * tests import these comparisons directly.
 */
import type { ValkeyAclProfile, ValkeyAclUser } from './acl-attrs.ts';
import type { ParsedAclUser } from './acl-form.ts';
import {
  MONITOR_RULES,
  SEAT_RULES,
  SERVICE_RULES,
  declaredChannels,
  declaredKeyPatterns,
} from './acl-profiles.ts';

/** Whether two string lists carry the same members — order ignored, duplicates and extras caught
 * by the length guard (the echo's order is the server's business; a wider or duplicated list is
 * not). */
export const sameSet = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean => {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
};

/**
 * Recognise a live rule set as one of the three fixed profiles. The echo is normalised first
 * (`acl-form.ts`'s header): drop the `-@all` baseline the server echoes for a reset user, since
 * the seat set never grants it back and a `+@all` cancels it. `unrecognized` means something
 * outside the stack edited the rules — that user drifts.
 */
export const inferProfile = (rules: ReadonlyArray<string>): ValkeyAclProfile | 'unrecognized' => {
  const normalised = rules.filter((rule) => rule !== '-@all');
  if (sameSet(normalised, SEAT_RULES)) return 'seat';
  if (sameSet(normalised, SERVICE_RULES)) return 'service';
  if (sameSet(rules, MONITOR_RULES)) return 'monitor';
  return 'unrecognized';
};

/**
 * Whether a live user line is exactly as declared — every visible disagreement is a match failure,
 * not just a changed prefix (a widened rule set, a disabled flag, or a stripped password is exactly
 * what reconcile exists to restore). Passwords are never compared here: the live line holds only a
 * hash, and the stored seal is what `diff`/`reconcile` check for rotation.
 */
export const matchesDeclared = (live: ParsedAclUser, user: ValkeyAclUser): boolean =>
  live.name === user.name &&
  live.on &&
  !live.nopass &&
  live.hasPassword &&
  sameSet(live.keyPatterns, declaredKeyPatterns(user)) &&
  sameSet(live.channelPatterns, declaredChannels(user)) &&
  inferProfile(live.rules) === user.profile;
