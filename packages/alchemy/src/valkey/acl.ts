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
  ValkeyAclUserAttributes,
} from './acl-attrs.ts';
import { buildDelUserArgs, passwordState, refusalBeforeWrite } from './acl-form.ts';
import { sameSet } from './acl-compare.ts';
import { readAclFileConfig, readParsedUsers, readWithExecutor } from './acl-ops.ts';
import { reconcileWithExecutor } from './acl-reconcile.ts';
import { declaredChannels, effectiveKeyPrefix } from './acl-profiles.ts';
import { type ValkeyConnection, withValkey } from './connection.ts';
import { ValkeyAclFileRendered, ValkeyInstanceUnreachable } from './errors.ts';
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

export const makeValkeyAclFileHandlers = (
  connect: typeof withValkey = withValkey,
): Provider.ProviderService<
  ValkeyAclFile,
  ValkeyConnection,
  never,
  never,
  ValkeyConnection,
  ValkeyConnection
> =>
  ValkeyAclFile.Provider.of({
    list: () => Effect.succeed([]),
    nuke: { skip: true },

    read: ({ output, olds }) =>
      Effect.gen(function* () {
        const props = output ?? olds;
        // A socket that never reached the instance is the typed unreachable failure (F4): the
        // handler knows the instance name and the connection layer's host/port, so it names them.
        // An AUTH refusal is already a typed ValkeyServerError (`connection.ts`); no
        // swallow and no `undefined`, which would misreport a dead instance as "not yet created".
        const live = yield* connect((ex, config) =>
          readWithExecutor(ex, props.instance, config.username).pipe(
            Effect.catchTag('ValkeySocketError', () =>
              Effect.fail(
                new ValkeyInstanceUnreachable({
                  instance: props.instance,
                  host: config.host,
                  port: config.port,
                }),
              ),
            ),
          ),
        );
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
        const refused = refusalBeforeWrite(news.instance, news.users);
        if (refused !== undefined) return yield* Effect.fail(refused);
        if (output === undefined) return undefined;
        const declared = Object.keys(news.users).sort();
        const liveNames = Object.keys(output.users).sort();
        if (news.exclusive && declared.length !== liveNames.length)
          return { action: 'update' } as const;
        for (const [name, user] of Object.entries(news.users)) {
          const live = output.users[name];
          if (
            live === undefined ||
            live.keyPrefix !== effectiveKeyPrefix(user) ||
            live.extraKeyPatterns.length > 0 ||
            !sameSet(live.channelPatterns, [...declaredChannels(user)]) ||
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
      connect((ex, config) =>
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
      connect((ex, config) =>
        Effect.gen(function* () {
          // ⛔ GATE FIRST (F3): a rendered aclfile is the source of truth, so this family deletes
          //   nothing there either — the file's renderer re-adds what the kit would DELUSER.
          const aclfile = yield* readAclFileConfig(ex);
          if (aclfile !== '') {
            return yield* Effect.fail(
              new ValkeyAclFileRendered({ instance: olds.instance, path: aclfile }),
            );
          }
          // Removing the declaration removes every user it managed (the engine runs this only
          // when a human opts out of retain); the instance itself is untouched, and undeclared
          // users are preserved (F1). `ACL DELUSER` ignores absent names (Valkey docs);
          // reading first also avoids an empty DELUSER command on a repeated delete (S14).
          const live = yield* readParsedUsers(ex, config.username);
          const targets = Object.keys(olds.users).filter((name) => live[name] !== undefined);
          if (targets.length === 0) return;
          const reply = yield* ex.send(buildDelUserArgs(targets));
          if (reply.kind === 'error') {
            return yield* Effect.fail(new ValkeyServerError({ detail: reply.message }));
          }
          return;
        }).pipe(
          // A socket that never reached the instance is the typed unreachable failure (F4).
          Effect.catchTag('ValkeySocketError', () =>
            Effect.fail(
              new ValkeyInstanceUnreachable({
                instance: olds.instance,
                host: config.host,
                port: config.port,
              }),
            ),
          ),
        ),
      ),
  });

export const valkeyAclFileHandlers = makeValkeyAclFileHandlers();

export const ValkeyAclFileProvider = () => Provider.succeed(ValkeyAclFile, valkeyAclFileHandlers);
