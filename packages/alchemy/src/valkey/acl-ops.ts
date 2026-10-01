/**
 * `Valkey.AclFile` READ operations, engine-independent: reading the live ACL into attributes,
 * and the aclfile probe the write path gates on. Extracted from `acl.ts` (the Resource and its
 * handlers) to keep files under the cap; `acl.test.ts` drives these against `fake-valkey.ts`.
 *
 * ⛔ PASSWORD BY REFERENCE. Each `user.password` is a `{ fromEnv }` reference; state stores a
 *   scrypt seal so the next plan can tell whether the value changed without holding the value.
 *   See `secrets/write-only.ts` and `acl-attrs.ts`.
 * ★ NO OWNERSHIP MARK (H1). `read` answers `Unowned` for a match (the same rule as
 *   `Postgres.Database`), so an adopted instance's ACL needs `adopt(true)`.
 * ★ THE SEALS THREAD THROUGH `output` THE WAY `LiteLLM.MCPServer`'s `credentialSeal` DOES
 *   (`mcp-server.ts`): `read` never re-seals — it keeps the seal the store already holds. The
 *   write path (`acl-reconcile.ts`) mints a fresh one only for a user it actually wrote.
 */
import * as Effect from 'effect/Effect';
import { inferProfile } from './acl-compare.ts';
import type { ValkeyAclFileAttributes, ValkeyAclUserAttributes } from './acl-attrs.ts';
import { type ParsedAclUser, parseAclLine } from './acl-form.ts';
import { ValkeyAclParseError } from './errors.ts';
import {
  type ValkeyExecutor,
  ValkeyServerError,
  type ValkeyTransportError,
  arrayPairs,
} from './transport.ts';

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
        catch: () => new ValkeyAclParseError(),
      });
      if (parsed.name === 'default' || parsed.name === self) continue;
      users[parsed.name] = parsed;
    }
    return users;
  });

/** One user's live attributes from its parsed line. Passwords are never read (Valkey returns only
 * hashes, and this family stores seals, not values), so the seal starts empty and `read` threads
 * the stored one through `output`. */
export const toUserAttributes = (line: ParsedAclUser): ValkeyAclUserAttributes => ({
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

/** Probe `CONFIG GET aclfile`: empty means the kit owns ACL state (runtime SETUSER/DELUSER only —
 * never `ACL SAVE`, which errors without a configured aclfile); non-empty means a rendered file
 * is the source of truth and the write path refuses (see `ValkeyAclFileRendered`). */
export const readAclFileConfig = (
  executor: ValkeyExecutor,
): Effect.Effect<string, ValkeyTransportError> =>
  Effect.gen(function* () {
    const reply = yield* executor.send(['CONFIG', 'GET', 'aclfile']);
    if (reply.kind === 'error') {
      return yield* Effect.fail(new ValkeyServerError({ detail: reply.message }));
    }
    if (reply.kind !== 'array') {
      return yield* Effect.fail(
        new ValkeyServerError({ detail: 'CONFIG GET aclfile did not answer an array' }),
      );
    }
    const path = arrayPairs(reply.values).get('aclfile');
    if (path === undefined || path === null)
      return yield* Effect.fail(
        new ValkeyServerError({ detail: 'CONFIG GET aclfile omitted aclfile' }),
      );
    return path;
  });
