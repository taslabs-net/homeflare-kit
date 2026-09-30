/**
 * The member roster half of `LiteLLM.Team`: reading it, and what a declared roster still needs.
 *
 * ⛔ ADDITIVE ONLY, AND THAT IS A SAFETY RULE, NOT A SHORTCUT. `/team/member_delete` does not only take a
 *   user off the roster: it also DELETES every virtual key that user created for the team
 *   (`litellm_verificationtoken.delete_many` where `user_id` and `team_id`, `team_endpoints.py`
 *   lines 3701-3748, 1.103.0). A seat's key would vanish with a roster edit. So a live member the declaration does not
 *   list is never removed and never an error; `delete` on the team is the only removal, and it too
 *   deletes the team's keys (team.ts).
 * ★ A ROLE IS CHANGED THROUGH `/team/member_update`, which rewrites the roster entry under the team's
 *   advisory lock. `admin` is Enterprise on both routes (`team_endpoints.py` lines 2713-2723 and
 *   3806-3810): a proxy without a licence answers 400, the deploy fails with it, and the roster stays
 *   as it was.
 * ⚠️ A NEW USER ID CREATES A USER ROW (`add_new_member`), and only PROXY_ADMIN may name an id that has no
 *   user yet (`_validate_member_user_id_provisioning`, 403 otherwise).
 */
import { asRow } from './registry-support.ts';
import type { TeamMember, TeamMemberAttributes } from './team-types.ts';

/** The roster of a `team_info` row. An entry with no `user_id` (an email-only invite) is skipped. */
export const toMemberAttributes = (value: unknown): readonly TeamMemberAttributes[] => {
  if (!Array.isArray(value)) return [];
  const members: TeamMemberAttributes[] = [];
  for (const entry of value) {
    const row = asRow(entry);
    if (typeof row?.['user_id'] === 'string' && row['user_id'] !== '') {
      members.push({
        role: typeof row['role'] === 'string' ? row['role'] : 'user',
        userId: row['user_id'],
      });
    }
  }
  return members.sort((a, b) => a.userId.localeCompare(b.userId));
};

const roleOf = (member: TeamMember): string => member.role ?? 'user';

/** Declared members that are not on the live roster at all. */
export const membersToAdd = (
  live: readonly TeamMemberAttributes[],
  declared: readonly TeamMember[] | undefined,
): readonly TeamMember[] =>
  (declared ?? []).filter((member) => !live.some((each) => each.userId === member.userId));

/** Declared members that are on the roster with another role. */
export const roleChanges = (
  live: readonly TeamMemberAttributes[],
  declared: readonly TeamMember[] | undefined,
): readonly TeamMember[] =>
  (declared ?? []).filter((member) =>
    live.some((each) => each.userId === member.userId && each.role !== roleOf(member)),
  );

/** Whether the declared roster is fully present. Extra live members do not count. */
export const rosterPending = (
  live: readonly TeamMemberAttributes[],
  declared: readonly TeamMember[] | undefined,
): boolean => membersToAdd(live, declared).length + roleChanges(live, declared).length > 0;
