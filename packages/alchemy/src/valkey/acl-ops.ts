/**
 * `Valkey.AclFile` operations, engine-independent: reading the live ACL into attributes, and the
 * reconcile core every handler calls. Extracted from `acl.ts` (the Resource and its handlers) to
 * keep both files under the cap; `acl.test.ts` drives these against `fake-valkey.ts` directly.
 *
 * ⛔ PASSWORD BY REFERENCE. Each `user.password` is a `{ fromEnv }` reference; state stores a
 *   scrypt seal so the next plan can tell whether the value changed without holding the value.
 *   See `secrets/write-only.ts` and `acl-attrs.ts`. A rotation is a rewrite of the whole user
 *   (`reset` first — measured, see `acl-form.ts`), so a rotated-out password stops
 *   authenticating.
 * ★ NO OWNERSHIP MARK (H1). `read` answers `Unowned` for a match (the same rule as
 *   `Postgres.Database`), so an adopted instance's ACL needs `adopt(true)`.
 * ★ THE SEALS THREAD THROUGH `output` THE WAY `LiteLLM.MCPServer`'s `credentialSeal` DOES
 *   (`mcp-server.ts`): `read` never re-seals — it keeps the seal the store already holds, and
 *   only a reconcile that actually wrote a password mints a fresh one. An adopted user has no
 *   seal yet, which is what makes its first plan a write.
 */
import * as Effect from 'effect/Effect';
import { type Environment, type FromEnv, resolveAll, seal } from '../secrets/write-only.ts';
import type {
  ValkeyAclFileAttributes,
  ValkeyAclFileProps,
  ValkeyAclUser,
  ValkeyAclUserAttributes,
} from './acl-attrs.ts';
import {
  type ParsedAclUser,
  buildDelUserArgs,
  buildSetUserArgs,
  inferProfile,
  matchesDeclared,
  parseAclLine,
  passwordState,
  planAclUsers,
  refusalBeforeWrite,
} from './acl-form.ts';
import {
  ValkeyAclParseError,
  ValkeyAclPasswordMissing,
  ValkeyAclReadbackFailed,
  type ValkeyError,
} from './errors.ts';
import { type ValkeyExecutor, ValkeyServerError, type ValkeyTransportError } from './transport.ts';

/** Parse the live `ACL LIST` into its user lines, keyed by username. `self` is the username the
 * stack's own connection authenticates as (the instance's admin user) — never this family's to
 * manage: removing it would lock the kit out of the instance, and a `service` user cannot carry
 * ACL commands anyway, so it is skipped exactly like `default`. A line that does not parse fails
 * the whole read: a user this family cannot see is a user it cannot converge. */
export const readParsedUsers = (
  executor: ValkeyExecutor,
  self?: string,
): Effect.Effect<
  Readonly<Record<string, ParsedAclUser>>,
  ValkeyAclParseError | ValkeyTransportError
> =>
  Effect.gen(function* () {
    const reply = yield* executor.send(['ACL', 'LIST']);
    if (reply.kind === 'error') {
      return yield* Effect.fail(new ValkeyServerError({ detail: reply.message }));
    }
    if (reply.kind !== 'array') {
      return yield* Effect.fail(
        new ValkeyServerError({ detail: 'ACL LIST did not answer an array' }),
      );
    }
    const users: Record<string, ParsedAclUser> = {};
    for (const line of reply.values) {
      if (line === null) continue;
      const parsed = yield* Effect.try({
        try: () => parseAclLine(line),
        catch: () => new ValkeyAclParseError({ line }),
      });
      if (parsed.name === 'default' || parsed.name === self) continue;
      users[parsed.name] = parsed;
    }
    return users;
  });

/** One user's live attributes from its parsed line. Passwords are never read (Valkey returns only
 * hashes, and this family stores seals, not values), so the seal starts empty and `read` threads
 * the stored one through `output`. */
const toUserAttributes = (line: ParsedAclUser): ValkeyAclUserAttributes => ({
  name: line.name,
  keyPrefix: line.keyPatterns[0]?.slice(1) ?? '',
  extraKeyPatterns: line.keyPatterns.slice(1).map((pattern) => pattern.slice(1)),
  channelPatterns: [...line.channelPatterns],
  profile: inferProfile(line.rules),
  on: line.on,
  nopass: line.nopass,
  hasPassword: line.hasPassword,
  passwordSeal: '',
});

/** Live attributes from parsed lines. Passwords are never read (Valkey returns only hashes, and
 * this family stores seals, not values), so the seal starts empty and `read` threads the stored
 * one through `output`. */
const toAttributes = (
  instance: string,
  parsed: Readonly<Record<string, ParsedAclUser>>,
): ValkeyAclFileAttributes => {
  const users: Record<string, ValkeyAclUserAttributes> = {};
  for (const [name, line] of Object.entries(parsed)) {
    users[name] = toUserAttributes(line);
  }
  return { instance, users };
};

/** Read the live ACL users into attributes, against any executor. `self` (the connection's own
 * username) is skipped along with `default` — see `readParsedUsers`. */
export const readWithExecutor = (
  executor: ValkeyExecutor,
  instance: string,
  self?: string,
): Effect.Effect<ValkeyAclFileAttributes, ValkeyAclParseError | ValkeyTransportError> =>
  Effect.map(readParsedUsers(executor, self), (parsed) => toAttributes(instance, parsed));

/** The reconcile core, against any executor: read the live ACL, plan create/update/remove, add
 * rotations the stored seals reveal, write with `reset`-first SETUSER, then re-read and verify
 * every declared user (S10: never trust the write). `stored` is the state this stack already
 * holds (`output`); it is what adoption lacks, and its absence is what makes the first plan a
 * write. */
export const reconcileWithExecutor = (
  executor: ValkeyExecutor,
  props: ValkeyAclFileProps,
  stored: ValkeyAclFileAttributes | undefined,
  env: Environment = process.env,
  self?: string,
): Effect.Effect<ValkeyAclFileAttributes, ValkeyError | ValkeyTransportError> =>
  Effect.gen(function* () {
    // ⛔ BEFORE ANY WRITE. Reserved names, a split record key, and a seat prefix other than
    //   `<name>:*` are refused here — see `refusalBeforeWrite`. Read hides `default` and the
    //   connection username, so a declaration of either would otherwise look absent and `reset`
    //   the credential this kit authenticates with.
    const refused = refusalBeforeWrite(props.instance, props.users, self);
    if (refused !== undefined) return yield* Effect.fail(refused);

    const live = yield* readParsedUsers(executor, self);
    const { create, update, remove } = planAclUsers(props.users, live);

    // Resolve every declared password ONCE, at call time. A user the plan does not need to write
    // does not demand its variable — that is the `unknown` state, and it never drifts (diff).
    const refs: Record<string, FromEnv> = {};
    for (const [name, user] of Object.entries(props.users)) refs[name] = user.password;
    const { values } = resolveAll(refs, env);

    // Rotate: live and shaped exactly as declared, but the stored seal is absent (an adopted
    // user) or disagrees with the value this process holds — the reset-first rewrite is what
    // retires the old password, so the seal change must reach the server, not only the state.
    const rotate = Object.entries(props.users)
      .filter(([name, user]) => {
        const liveUser = live[name];
        const sealed = stored?.users[name]?.passwordSeal ?? '';
        return (
          liveUser !== undefined &&
          matchesDeclared(liveUser, user) &&
          passwordState(sealed, values[name]) === 'stale'
        );
      })
      .map(([, user]) => user);

    // Every write re-sends the password (`reset` clears it), so a write without the value would
    // leave the user unable to authenticate — refused, naming the first user and variable. The
    // refusal is checked for EVERY user before the first write, so a missing variable never
    // leaves half of the plan applied.
    const writes = [...create, ...update, ...rotate];
    const writeList: Array<{ readonly user: ValkeyAclUser; readonly password: string }> = [];
    for (const user of writes) {
      const password = values[user.name];
      if (password === undefined) {
        return yield* Effect.fail(
          new ValkeyAclPasswordMissing({
            instance: props.instance,
            user: user.name,
            variable: user.password.fromEnv,
          }),
        );
      }
      writeList.push({ user, password });
    }

    for (const { user, password } of writeList) {
      const reply = yield* executor.send(buildSetUserArgs(user, password));
      if (reply.kind === 'error') {
        return yield* Effect.fail(new ValkeyServerError({ detail: reply.message }));
      }
    }
    if (remove.length > 0) {
      const reply = yield* executor.send(buildDelUserArgs(remove));
      if (reply.kind === 'error') {
        return yield* Effect.fail(new ValkeyServerError({ detail: reply.message }));
      }
    }

    // Read back and verify: every declared user, exactly as declared, and no user left over
    // (the connection's own username and `default` are never in the map — never managed).
    const after = yield* readParsedUsers(executor, self);
    for (const [name, user] of Object.entries(props.users)) {
      const parsed = after[name];
      if (parsed === undefined || !matchesDeclared(parsed, user)) {
        return yield* Effect.fail(
          new ValkeyAclReadbackFailed({ instance: props.instance, user: name }),
        );
      }
    }
    for (const name of Object.keys(after)) {
      if (props.users[name] === undefined) {
        return yield* Effect.fail(
          new ValkeyAclReadbackFailed({ instance: props.instance, user: name }),
        );
      }
    }

    // Seals: keep what the store held for users this run did not write, mint a fresh one for
    // every user it did. A user absent from `stored` (adoption) gets its first seal here.
    const seals: Record<string, string> = {};
    for (const name of Object.keys(props.users)) {
      seals[name] = stored?.users[name]?.passwordSeal ?? '';
    }
    for (const { user, password } of writeList) seals[user.name] = seal({ password });
    const users: Record<string, ValkeyAclUserAttributes> = {};
    for (const [name, parsed] of Object.entries(after)) {
      users[name] = { ...toUserAttributes(parsed), passwordSeal: seals[name] ?? '' };
    }
    return { instance: props.instance, users };
  });
