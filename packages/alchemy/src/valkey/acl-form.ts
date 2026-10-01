/**
 * Pure helpers for `Valkey.AclFile`: building `ACL SETUSER` argument lists, parsing `ACL LIST`
 * lines, computing the create/update/remove plan, and the refusals that run before any write.
 *
 * ⛔ THE COMMAND ALLOW-LIST IS A FIXED PROFILE, NOT PROP (see `acl-profiles.ts`). Widening in the
 *   declaration would let a seat request `FLUSHALL` or `ACL SETUSER` and defeat the isolation the
 *   resource exists to enforce.
 * ★ `reset` IS LOAD-BEARING, MEASURED ON VALKEY 9.1.1 (2026-09-29). `ACL SETUSER` ADDS rules; a
 *   second `>pw` without `reset` left TWO valid password hashes and two key patterns — a rotated
 *   password kept authenticating forever. `reset` first, rebuild, makes the command idempotent:
 *   after it the user holds exactly one password, one key pattern and one channel pattern.
 * ★ THE PASSWORD GOES ON THE WIRE AS `#<sha256>`, NOT `>plaintext` (round-3). Valkey accepts the
 *   hash form (ct100#117's templates render `#{{ . | sha256Hex }}` and the 9.1.1 scratch
 *   authenticated against it, measured 2026-09-30): the plaintext never leaves the deploying
 *   process's memory at all, and a command echo or audit log holds only an unreversible hash.
 * ★ THE SERVER'S ECHO IS NORMALISED, ALSO MEASURED. `ACL LIST` answers the stored rule list, and:
 *   the `reset` baseline appears as an explicit `-@all` token (which survives until `+@all`
 *   cancels it — a fresh user written WITHOUT `reset` echoed `-@all` too); `allchannels` echoes
 *   as the `&*` pattern; an empty channel list echoes the bare `resetchannels` marker (which
 *   means NO channel access — PUBLISH as such a user answered `NOPERM`); `reset` itself is
 *   dropped from the echo. Every comparison normalises that: drop `-@all` before comparing
 *   `SEAT_RULES` (the seat set never grants it back), compare the other sets directly, ignore
 *   the bare `resetchannels` marker when parsing.
 */
import { sha256 } from 'alchemy/Util/sha256';
import * as Effect from 'effect/Effect';
import type { ValkeyAclUser } from './acl-attrs.ts';
import { declaredChannels, declaredKeyPatterns, profileRules } from './acl-profiles.ts';
import {
  ValkeyAclChannelPatterns,
  ValkeyAclMonitorKeyPrefix,
  ValkeyAclNameGlob,
  ValkeyAclParseError,
  ValkeyAclReservedUser,
  ValkeyAclSeatKeyPrefix,
  ValkeyAclUserNameMismatch,
} from './errors.ts';
import { type Environment, type FromEnv, resolveAll, sealMatches } from '../secrets/write-only.ts';
import { matchesDeclared } from './acl-compare.ts';

/** Glob characters a username must not carry: the name is interpolated into patterns. */
const NAME_GLOB = /[*?[\]\\]/;

/** The `#<sha256>` token `ACL SETUSER` accepts in place of `>plaintext`. */
export const passwordToken = (password: string): Effect.Effect<string> =>
  Effect.map(sha256(password), (hash) => `#${hash}`);

/**
 * The exact `ACL SETUSER` argument list the family issues for one user: reset the blank user,
 * enable it, one password hash, channels reset to the profile's scope, the declared key pattern,
 * then the profile's rules. `password` is the RESOLVED value (already checked present by the
 * caller), never stored, never returned; only its sha256 crosses the wire.
 */
export const buildSetUserArgs = (
  user: ValkeyAclUser,
  password: string,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.map(passwordToken(password), (token) => [
    'ACL',
    'SETUSER',
    user.name,
    'reset',
    'on',
    token,
    'resetchannels',
    ...declaredChannels(user),
    ...declaredKeyPatterns(user),
    ...profileRules(user.profile),
  ]);

/** One `ACL LIST` line, parsed. `rules` holds the `+`/`-` tokens the server echoes (normalised,
 * see the header); `keyPatterns`/`channelPatterns` keep their `~`/`&`; flags are booleans. */
export interface ParsedAclUser {
  readonly name: string;
  readonly on: boolean;
  readonly nopass: boolean;
  /** Any password token (`#<hash>`, `>pw`, `<pw`) present. */
  readonly hasPassword: boolean;
  readonly keyPatterns: ReadonlyArray<string>;
  readonly channelPatterns: ReadonlyArray<string>;
  readonly rules: ReadonlyArray<string>;
}

/** Tokens the server echoes as state markers, never as rules or patterns. */
const MARKER_TOKENS = new Set(['resetchannels', 'resetkeys', 'resetpass', 'reseton', 'resetoff']);

/** Parse one `ACL LIST` line into `ParsedAclUser`. Throws `ValkeyAclParseError` on a malformed
 * line. */
export const parseAclLine = (line: string): ParsedAclUser => {
  const parts = line.split(' ');
  if (parts[0] !== 'user' || parts[1] === undefined || parts[1] === '') {
    throw new ValkeyAclParseError();
  }
  const on = parts[2] === 'on';
  const nopass = parts.includes('nopass');
  const keyPatterns: string[] = [];
  const channelPatterns: string[] = [];
  const rules: string[] = [];
  let hasPassword = false;
  for (const part of parts.slice(2)) {
    if (part.startsWith('~')) keyPatterns.push(part);
    else if (part.startsWith('&')) channelPatterns.push(part);
    else if (part.startsWith('>') || part.startsWith('<') || part.startsWith('#'))
      hasPassword = true;
    else if (part.startsWith('+') || part.startsWith('-')) rules.push(part);
    else if (MARKER_TOKENS.has(part)) continue;
    // Anything else (a flag a future Valkey adds) is neither a rule nor a pattern nor a
    // credential; ignored.
  }
  return { name: parts[1], on, nopass, hasPassword, keyPatterns, channelPatterns, rules };
};

/** Whether a seat-profile user's key prefix escapes its own keyspace. `keyPrefix` goes on the
 * wire as `~<keyPrefix>`, so read-back compares the declaration to itself: `*`, `grok:*` or
 * `claude:grok:*` would converge and grant keys the seat does not own. CT100's template renders
 * exactly `~${user}:*`. A service user is exempt: owning the whole instance is what that
 * profile is for (LiteLLM's cache user, `*`). A monitor user is keyless and may not carry a
 * prefix at all. */
export const seatKeyPrefixEscapes = (user: ValkeyAclUser): boolean =>
  user.profile === 'seat' && (user.keyPrefix ?? `${user.name}:*`) !== `${user.name}:*`;

/** Refusals must run before any `ACL SETUSER`. A mismatched record key would split one user into
 * two records; a reserved name would reset the credential this kit authenticates with; a glob in
 * a name would widen the patterns the profile fixes; a seat prefix or monitor key prefix
 * contradicts the profile's fixed shape. */
export const refusalBeforeWrite = (
  instance: string,
  users: Readonly<Record<string, ValkeyAclUser>>,
  self?: string,
):
  | ValkeyAclUserNameMismatch
  | ValkeyAclReservedUser
  | ValkeyAclSeatKeyPrefix
  | ValkeyAclMonitorKeyPrefix
  | ValkeyAclNameGlob
  | ValkeyAclChannelPatterns
  | undefined => {
  for (const [key, user] of Object.entries(users)) {
    if (user.name !== key) {
      return new ValkeyAclUserNameMismatch({ instance, recordKey: key, user: user.name });
    }
    if (user.name === 'default' || user.name === self) {
      return new ValkeyAclReservedUser({ instance, user: user.name });
    }
    const glob = NAME_GLOB.exec(user.name);
    if (glob !== null) {
      return new ValkeyAclNameGlob({ instance, user: user.name, chars: glob[0] });
    }
    if (seatKeyPrefixEscapes(user)) {
      return new ValkeyAclSeatKeyPrefix({
        instance,
        user: user.name,
        keyPrefix: user.keyPrefix ?? `${user.name}:*`,
      });
    }
    if (
      user.channelPatterns !== undefined &&
      ((user.profile === 'monitor' && user.channelPatterns.length > 0) ||
        (user.profile === 'seat' &&
          (user.channelPatterns.length !== 1 || user.channelPatterns[0] !== `${user.name}:*`)))
    )
      return new ValkeyAclChannelPatterns({ instance, user: user.name });
    if (user.profile === 'monitor' && user.keyPrefix !== undefined) {
      return new ValkeyAclMonitorKeyPrefix({
        instance,
        user: user.name,
        keyPrefix: user.keyPrefix,
      });
    }
  }
  return undefined;
};

/** How the environment compares to what the family last wrote for one user, by seal.
 * `unknown` — the variable is unset here, so the plan cannot tell (never drift: a plan-only
 * environment must not report every user as rotated). `stale` — no seal yet (an adopted user) or
 * the seal disagrees with the current value. `match` — the seal was made from this value. */
export type PasswordState = 'unknown' | 'stale' | 'match';

export const passwordState = (sealed: string, value: string | undefined): PasswordState => {
  if (value === undefined) return 'unknown';
  if (sealed === '') return 'stale';
  return sealMatches(sealed, { password: value }) ? 'match' : 'stale';
};

/** The password value of one user in `env`, or undefined when the reference is missing. */
export const resolvedPassword = (user: ValkeyAclUser, env: Environment): string | undefined => {
  const ref: Record<string, FromEnv> = { [user.name]: user.password };
  const { values, missing } = resolveAll(ref, env);
  if (missing.length > 0) return undefined;
  return values[user.name];
};

/** The plan reconcile walks: `create` (absent live), `update` (present but not exactly as
 * declared — see `matchesDeclared`), `remove` (previously managed users removed from the
 * declaration, plus all undeclared users under `exclusive: true`) and `undeclared` (all live
 * names outside the current declaration, reported with their deletion/preservation decision). */
export interface AclUserPlan {
  readonly create: ReadonlyArray<ValkeyAclUser>;
  readonly update: ReadonlyArray<ValkeyAclUser>;
  readonly remove: ReadonlyArray<string>;
  readonly undeclared: ReadonlyArray<string>;
}

export const planAclUsers = (
  declared: Readonly<Record<string, ValkeyAclUser>>,
  live: Readonly<Record<string, ParsedAclUser>>,
  exclusive = false,
  managed: ReadonlyArray<string> = [],
): AclUserPlan => {
  const create: ValkeyAclUser[] = [];
  const update: ValkeyAclUser[] = [];
  const undeclared: string[] = [];
  for (const [name, user] of Object.entries(declared)) {
    const liveUser = live[name];
    // ⛔ UPDATE MUST CATCH EVERY VISIBLE DISAGREEMENT, NOT JUST A CHANGED PREFIX. A user whose
    // rules were widened outside the stack (or disabled, or stripped of its password) is exactly
    // what this family exists to restore; a prefix-only criterion would leave it failing
    // read-back forever instead of converging on the next plan.
    if (liveUser === undefined) create.push(user);
    else if (!matchesDeclared(liveUser, user)) update.push(user);
  }
  for (const name of Object.keys(live)) {
    if (declared[name] === undefined) undeclared.push(name);
  }
  return {
    create,
    update,
    remove: exclusive ? undeclared : undeclared.filter((name) => managed.includes(name)),
    undeclared,
  };
};

/** The exact `ACL DELUSER` argument list. */
export const buildDelUserArgs = (users: ReadonlyArray<string>): ReadonlyArray<string> => [
  'ACL',
  'DELUSER',
  ...users,
];
