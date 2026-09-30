/**
 * Pure helpers for `Valkey.AclFile`: building `ACL SETUSER` argument lists, parsing `ACL LIST`
 * lines, and computing which users to create/update/rotate/remove.
 *
 * ⛔ THE COMMAND ALLOW-LIST IS A FIXED PROFILE, NOT A PROP (see `acl-attrs.ts`). `SEAT_RULES`
 *   mirrors `homeflare-ct100/src/valkey-acl.ts`'s `SEAT_COMMANDS` token for token; a profile prop
 *   picks between it and the `service` set. Widening it by declaration would let a seat request
 *   `FLUSHALL` or `ACL SETUSER` and defeat the isolation this resource exists to enforce.
 * ★ `reset` IS LOAD-BEARING, MEASURED ON VALKEY 9.1.1 (2026-09-29). `ACL SETUSER` ADDS rules; a
 *   second `>pw` without `reset` left TWO valid password hashes and two key patterns — a rotated
 *   password would keep authenticating forever. `reset` first, then rebuild, is what makes the
 *   command idempotent: after it, the user holds exactly one password, one key pattern and one
 *   channel pattern.
 * ★ THE SERVER'S ECHO IS NORMALISED, ALSO MEASURED. `ACL LIST` answers a stored `rule` list, and:
 *   a `reset` baseline appears as an explicit `-@all` token that survives until `+@all` cancels it
 *   (a fresh user written WITHOUT `reset` echoed `-@all` too); `allchannels` echoes as the
 *   `&*` pattern; an empty channel list echoes as the bare `resetchannels` marker and means NO
 *   channel access (PUBLISH as such a user answered `NOPERM`); `reset` itself is dropped from the
 *   echo. Every comparison here normalises for that: drop `-@all` before comparing to `SEAT_RULES`
 *   (which never grants it back), compare `SERVICE_RULES` directly, and ignore the bare
 *   `resetchannels` marker when parsing.
 */
import type { ValkeyAclProfile, ValkeyAclUser } from './acl-attrs.ts';
import { sealMatches } from '../secrets/write-only.ts';
import {
  ValkeyAclParseError,
  ValkeyAclReservedUser,
  ValkeyAclSeatKeyPrefix,
  ValkeyAclUserNameMismatch,
} from './errors.ts';

/** The seat command allow-list — fixed, mirrored from `homeflare-ct100/src/valkey-acl.ts`. */
export const SEAT_COMMANDS =
  '+@read +@write +@string +@hash +@list +@set +@sortedset +@stream +@pubsub +@connection ' +
  '+@transaction -@dangerous -@admin -keys -flushall -flushdb -monitor -acl -config ' +
  '-shutdown -debug';

/** Commands that close keyspace/channel enumeration, measured as a leak without them
 * (seat-wiring-spec §5). */
const DENY = '-scan -randomkey -dbsize -pubsub';

/** The two fixed rule sets, as the exact tokens sent after `reset`. */
export const SEAT_RULES: ReadonlyArray<string> = [...SEAT_COMMANDS.split(' '), ...DENY.split(' ')];
export const SERVICE_RULES: ReadonlyArray<string> = ['+@all', '-@dangerous', ...DENY.split(' ')];

/** The exact `ACL SETUSER` argument list this family issues for one user: reset to a blank user,
 * enable it, one password, one key pattern, channels reset to the profile's scope, then the
 * profile's rules. The password is the RESOLVED value (already checked present by the caller),
 * never stored, never returned. */
export const buildSetUserArgs = (user: ValkeyAclUser, password: string): ReadonlyArray<string> => [
  'ACL',
  'SETUSER',
  user.name,
  'reset',
  'on',
  `>${password}`,
  'resetchannels',
  `~${user.keyPrefix}`,
  ...(user.profile === 'seat' ? [`&${user.name}:*`] : ['allchannels']),
  ...(user.profile === 'seat' ? SEAT_RULES : SERVICE_RULES),
];

/** One `ACL LIST` line, parsed. `rules` holds the `+`/`-` tokens the server echoes (normalised,
 * see the header); `keyPatterns`/`channelPatterns` keep their `~`/`&`; flags are booleans. */
export interface ParsedAclUser {
  readonly name: string;
  readonly on: boolean;
  readonly nopass: boolean;
  /** Any password token (`#<hash>`, `>pw`, `<pw`) is present. */
  readonly hasPassword: boolean;
  readonly keyPatterns: ReadonlyArray<string>;
  readonly channelPatterns: ReadonlyArray<string>;
  readonly rules: ReadonlyArray<string>;
}

/** Tokens the server echoes as state markers, never as rules or patterns. */
const MARKER_TOKENS = new Set(['resetchannels', 'resetkeys', 'resetpass', 'reseton', 'resetoff']);

/** Parse one `ACL LIST` line into `ParsedAclUser`. Throws `ValkeyAclParseError` on a line that
 * does not start `user <name>` — the caller decides whether that fails the read (it does; a line
 * this family cannot parse may be a user it cannot see). */
export const parseAclLine = (line: string): ParsedAclUser => {
  const parts = line.split(' ');
  if (parts[0] !== 'user' || parts[1] === undefined || parts[1] === '') {
    throw new ValkeyAclParseError({ line });
  }
  const keyPatterns: string[] = [];
  const channelPatterns: string[] = [];
  const rules: string[] = [];
  let on = false;
  let nopass = false;
  let hasPassword = false;
  for (const part of parts.slice(2)) {
    if (part.startsWith('~')) keyPatterns.push(part);
    else if (part.startsWith('&')) channelPatterns.push(part);
    else if (part.startsWith('>') || part.startsWith('<') || part.startsWith('#'))
      hasPassword = true;
    else if (part === 'on') on = true;
    else if (part === 'nopass') nopass = true;
    else if (part.startsWith('+') || part.startsWith('-')) rules.push(part);
    else if (MARKER_TOKENS.has(part)) continue;
    // Anything else (a flag a future Valkey adds) is not a rule, pattern or credential; ignored.
  }
  return { name: parts[1], on, nopass, hasPassword, keyPatterns, channelPatterns, rules };
};

/** Recognise which fixed profile a live rule set carries, or `unrecognized`. Drop the `-@all`
 * baseline the server keeps under any non-`+@all` rule set, then compare sets (order is the
 * server's, not ours). */
export const inferProfile = (rules: ReadonlyArray<string>): ValkeyAclProfile | 'unrecognized' => {
  const withoutAll = new Set(rules.filter((rule) => rule !== '-@all'));
  if (sameSet(withoutAll, new Set(SEAT_RULES))) return 'seat';
  if (sameSet(new Set(rules), new Set(SERVICE_RULES))) return 'service';
  return 'unrecognized';
};

const sameSet = <T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean =>
  left.size === right.size && [...left].every((item) => right.has(item));

/** Whether a seat-profile user's key prefix is anything but `<name>:*`. `keyPrefix` goes on
 * the wire as `~<keyPrefix>` and read-back compares the declaration to itself, so `*`,
 * `grok:*`, or `claude:grok:*` would converge and grant keys the seat does not own. CT100's
 * template is exactly `~${user}:*`. A service user is exempt: owning the instance is what
 * that profile is for (LiteLLM's cache user, `*`). */
export const seatKeyPrefixEscapes = (user: ValkeyAclUser): boolean =>
  user.profile === 'seat' && user.keyPrefix !== `${user.name}:*`;

/** Refusals that must run before any `ACL SETUSER`. A mismatched record key would split one
 * user into two records. `default` or the connection username, and a seat prefix other than
 * `<name>:*`, would otherwise look absent (read hides the reserved names) or converge
 * (read-back compares the declaration to itself) and then rewrite the live ACL. */
export const refusalBeforeWrite = (
  instance: string,
  users: Readonly<Record<string, ValkeyAclUser>>,
  self?: string,
): ValkeyAclUserNameMismatch | ValkeyAclReservedUser | ValkeyAclSeatKeyPrefix | undefined => {
  for (const [key, user] of Object.entries(users)) {
    if (user.name !== key) {
      return new ValkeyAclUserNameMismatch({ instance, recordKey: key, user: user.name });
    }
    if (user.name === 'default' || (self !== undefined && user.name === self)) {
      return new ValkeyAclReservedUser({ instance, user: user.name });
    }
    if (seatKeyPrefixEscapes(user)) {
      return new ValkeyAclSeatKeyPrefix({ instance, user: user.name, keyPrefix: user.keyPrefix });
    }
  }
  return undefined;
};

/** Whether two pattern lists hold the same members in any order — the shape `diff` compares
 * channel patterns with (the server's echo order is its own). */
export const sameMembers = <T>(left: ReadonlyArray<T>, right: ReadonlyArray<T>): boolean =>
  sameSet(new Set(left), new Set(right));

/** Whether a parsed live line IS the declared user — the read-back check (S10: never trust the
 * write). Name, enabled, password-bearing (never `nopass`), the declared key pattern, the
 * profile's channel scope, and the profile's rules. */
export const matchesDeclared = (live: ParsedAclUser, user: ValkeyAclUser): boolean =>
  live.on &&
  !live.nopass &&
  live.hasPassword &&
  sameSet(new Set(live.keyPatterns), new Set([`~${user.keyPrefix}`])) &&
  sameSet(
    new Set(live.channelPatterns),
    new Set(user.profile === 'seat' ? [`&${user.name}:*`] : ['&*']),
  ) &&
  inferProfile(live.rules) === user.profile;

/** How the environment compares to what this family last wrote for one user, by seal.
 * `unknown` — the variable is unset here, so a plan cannot tell (never drift: a plan-only
 * environment must not report every user as rotated). `stale` — no seal yet (an adopted user) or
 * the seal disagrees with the current value. `match` — the seal was made from this value. */
export type PasswordState = 'unknown' | 'stale' | 'match';

export const passwordState = (sealed: string, value: string | undefined): PasswordState => {
  if (value === undefined) return 'unknown';
  if (sealed === '') return 'stale';
  return sealMatches(sealed, { password: value }) ? 'match' : 'stale';
};

/** Compute the three user lists: `create` (absent live), `update` (present but not exactly as
 * declared — key prefix, channel scope, rule profile, enabled state or password presence
 * disagree; `matchesDeclared` decides), `remove` (declared-absent but live). Rotation is not
 * here: a user that matches in every visible way but whose password seal is stale is a rotate,
 * decided in reconcile where the resolved values and the stored seals live. Passwords are
 * never compared here — the seal check happens once values are resolved. */
export const planAclUsers = (
  declared: Readonly<Record<string, ValkeyAclUser>>,
  live: Readonly<Record<string, ParsedAclUser>>,
): {
  readonly create: ReadonlyArray<ValkeyAclUser>;
  readonly update: ReadonlyArray<ValkeyAclUser>;
  readonly remove: ReadonlyArray<string>;
} => {
  const create: ValkeyAclUser[] = [];
  const update: ValkeyAclUser[] = [];
  const remove: string[] = [];

  for (const [name, user] of Object.entries(declared)) {
    const liveUser = live[name];
    // ⛔ UPDATE MUST CATCH EVERY VISIBLE DISAGREEMENT, NOT JUST A CHANGED PREFIX. A user whose
    //   rules were widened outside this stack (or disabled, or stripped of its password) is
    //   exactly what this family exists to restore; a prefix-only criterion would leave it to
    //   fail the read-back forever instead of converging on the next plan.
    if (liveUser === undefined) create.push(user);
    else if (!matchesDeclared(liveUser, user)) update.push(user);
  }
  for (const name of Object.keys(live)) {
    if (declared[name] === undefined) remove.push(name);
  }
  return { create, update, remove };
};

/** The exact `ACL DELUSER` argument list. */
export const buildDelUserArgs = (users: ReadonlyArray<string>): ReadonlyArray<string> => [
  'ACL',
  'DELUSER',
  ...users,
];
