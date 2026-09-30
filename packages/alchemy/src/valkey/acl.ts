/**
 * `Valkey.AclFile` — the per-instance ACL users, each limited to a key prefix and a fixed command
 * profile, with passwords by reference (never in state). The operations live in `acl-ops.ts`
 * (extracted to keep both files under the cap); this file is the Resource and its handlers.
 *
 * ⛔ ONE ACL FILE PER INSTANCE, SEAT USERS ONLY. A shared file would let a seat user exist on the
 *   LiteLLM cache (:6380) and `litellm` on the seat store (:6381) — every seat could poison the
 *   response cache. The consuming stack declares one `Valkey.AclFile` per instance, holding only
 *   that instance's users.
 * ★ NO OWNERSHIP MARK (H1). `read` answers `Unowned` for a match (the same rule as
 *   `Postgres.Database`), so an adopted instance's ACL needs `adopt(true)`.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type {
  ValkeyAclFileAttributes,
  ValkeyAclFileProps,
  ValkeyAclUser,
  ValkeyAclUserAttributes,
} from './acl-attrs.ts';
import { buildDelUserArgs, passwordState, sameMembers, seatKeyPrefixEscapes } from './acl-form.ts';
import { readParsedUsers, readWithExecutor, reconcileWithExecutor } from './acl-ops.ts';
import { withValkey } from './connection.ts';
import {
  ValkeyAclSeatKeyPrefix,
  ValkeyAclUserNameMismatch,
  ValkeyInstanceUnreachable,
} from './errors.ts';
import { resolveAll } from '../secrets/write-only.ts';
import { ValkeyServerError } from './transport.ts';

export interface ValkeyAclFile extends Resource<
  'Valkey.AclFile',
  ValkeyAclFileProps,
  ValkeyAclFileAttributes
> {}

export const ValkeyAclFile = Resource<ValkeyAclFile>('Valkey.AclFile', {
  defaultRemovalPolicy: 'retain',
});

export const isValkeyAclFile = (value: unknown): value is ValkeyAclFile =>
  (typeof value === 'object' || typeof value === 'function') &&
  value !== null &&
  (value as { Type?: unknown }).Type === 'Valkey.AclFile';

/** The channel patterns the declaration expects for one user, in the server's own echo form. */
const declaredChannels = (user: ValkeyAclUser): ReadonlyArray<string> =>
  user.profile === 'seat' ? [`&${user.name}:*`] : ['&*'];

export const valkeyAclFileHandlers = ValkeyAclFile.Provider.of({
  list: () => Effect.succeed([]),
  nuke: { skip: true },

  read: ({ output, olds }) =>
    Effect.gen(function* () {
      const props = output ?? olds;
      // A failure (unreachable, unauthenticated) answers `undefined` so the engine reports a
      // create, which `reconcile` then turns into the typed failure — the same contract
      // `Valkey.Instance`'s read keeps.
      const live = yield* withValkey((ex, config) =>
        readWithExecutor(ex, props.instance, config.username),
      ).pipe(Effect.orElseSucceed(() => undefined));
      if (live === undefined) return undefined;
      // ★ THE STORED SEALS SURVIVE THE RE-READ (`mcp-server.ts`'s rule): a read must never
      //   mint, replace or drop a seal — it reports live users wearing the seals the store
      //   already holds, so an unchanged plan stays a no-op instead of churning the row.
      if (output === undefined) return Unowned(live);
      const users: Record<string, ValkeyAclUserAttributes> = {};
      for (const [name, user] of Object.entries(live.users)) {
        users[name] = { ...user, passwordSeal: output.users[name]?.passwordSeal ?? '' };
      }
      return { instance: live.instance, users };
    }),

  diff: ({ news, output }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      if (output === undefined) return undefined;
      for (const [key, user] of Object.entries(news.users)) {
        if (user.name !== key) {
          return yield* Effect.fail(
            new ValkeyAclUserNameMismatch({
              instance: news.instance,
              recordKey: key,
              user: user.name,
            }),
          );
        }
        // The plan refuses what reconcile refuses: a seat declaring `*` or another seat's
        // prefix would converge and pass read-back, holding every key on the instance.
        if (seatKeyPrefixEscapes(user)) {
          return yield* Effect.fail(
            new ValkeyAclSeatKeyPrefix({
              instance: news.instance,
              user: user.name,
              keyPrefix: user.keyPrefix,
            }),
          );
        }
      }
      const declared = Object.keys(news.users).sort();
      const liveNames = Object.keys(output.users).sort();
      if (declared.length !== liveNames.length) return { action: 'update' } as const;
      for (const [name, user] of Object.entries(news.users)) {
        const live = output.users[name];
        if (
          live === undefined ||
          live.keyPrefix !== user.keyPrefix ||
          live.extraKeyPatterns.length > 0 ||
          !sameMembers(live.channelPatterns, declaredChannels(user)) ||
          live.profile !== user.profile ||
          !live.on ||
          live.nopass ||
          !live.hasPassword
        ) {
          return { action: 'update' } as const;
        }
        // A password only drifts when this process holds it and the seal disagrees — an unset
        // variable is `unknown`, and a plan-only environment must not report every user rotated.
        const { values } = resolveAll({ password: user.password });
        if (passwordState(live.passwordSeal, values.password) === 'stale') {
          return { action: 'update' } as const;
        }
      }
      return { action: 'noop' } as const;
    }),

  reconcile: ({ news, output }) =>
    withValkey((ex, config) =>
      reconcileWithExecutor(ex, news, output, process.env, config.username).pipe(
        // The engine runs reconcile after `read` answered `undefined`, so a socket that never
        // reached the instance is what the plan surfaces — the typed failure, with the host
        // and port the connection layer actually holds. A server error reply (NOAUTH, an ACL
        // refusal) keeps its own tag: the server was reached, it refused.
        Effect.catchTag('ValkeySocketError', () =>
          Effect.fail(
            new ValkeyInstanceUnreachable({
              instance: news.instance,
              host: config.host,
              port: config.port,
            }),
          ),
        ),
      ),
    ),

  delete: ({ olds }) =>
    withValkey((ex) =>
      Effect.gen(function* () {
        // Removing the declaration removes every user it managed (the engine runs this only
        // when a human opts out of retain); the instance itself is untouched. `ACL DELUSER`
        // answers an error for a name that is already gone, so the users still live are read
        // first and only those are named — a re-run over a half-removed file stays a clean
        // success instead of a refusal (S14). The admin is only ever a target if a stack
        // wrongly declared it, which is a human choice to undo by hand.
        const live = yield* readParsedUsers(ex);
        const targets = Object.keys(olds.users).filter((name) => live[name] !== undefined);
        if (targets.length === 0) return { instance: olds.instance, users: {} };
        const reply = yield* ex.send(buildDelUserArgs(targets));
        if (reply.kind === 'error') {
          return yield* Effect.fail(new ValkeyServerError({ detail: reply.message }));
        }
        return { instance: olds.instance, users: {} };
      }),
    ),
});

export const ValkeyAclFileProvider = () => Provider.succeed(ValkeyAclFile, valkeyAclFileHandlers);
