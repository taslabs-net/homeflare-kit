/**
 * `Valkey.AclFile` reconcile core, against any executor. Extracted from the old single-file
 * `acl.ts` and reworked for the round-3 findings:
 *
 * ★ GATE FIRST (F3). `CONFIG GET aclfile` non-empty → `ValkeyAclFileRendered`, BEFORE any write.
 *   The rendered file is the source of truth (CT100: openbao-agent renders it and a runtime
 *   write reverts — the measured WRONGPASS seat). `delete` runs the same gate (`acl.ts`).
 * ★ RUNTIME-ONLY WRITES, NO `ACL SAVE` (F3). In kit-owned mode (empty aclfile) `ACL SAVE`
 *   measurably errors on 8.1.10 — "This instance is not configured to use an ACL file" — so the
 *   kit-owned family never calls it. ACL state is runtime state, not data: it does not survive
 *   a restart even with appendonly (measured), so this family re-asserts on every reconcile.
 * ★ NEVER-MANAGED USERS ARE PRESERVED BY DEFAULT (F1). `planAclUsers` only DELUSERs those
 *   under `exclusive: true`; removing a previously declared user always revokes it.
 */
import * as Effect from 'effect/Effect';
import { type Environment, type FromEnv, resolveAll, seal } from '../secrets/write-only.ts';
import type {
  ValkeyAclFileAttributes,
  ValkeyAclFileProps,
  ValkeyAclUser,
  ValkeyAclUserAttributes,
} from './acl-attrs.ts';
import { managedUserNames } from './acl-managed.ts';
import { matchesDeclared } from './acl-compare.ts';
import {
  buildDelUserArgs,
  buildSetUserArgs,
  passwordState,
  planAclUsers,
  refusalBeforeWrite,
} from './acl-form.ts';
import { readAclFileConfig, readParsedUsers, toUserAttributes } from './acl-ops.ts';
import {
  ValkeyAclFileRendered,
  ValkeyAclPasswordMissing,
  ValkeyAclReadbackFailed,
  type ValkeyError,
} from './errors.ts';
import { type ValkeyExecutor, ValkeyServerError, type ValkeyTransportError } from './transport.ts';

/** The reconcile core: gate on the rendered aclfile, refuse bad declarations, resolve every
 * password ONCE, plan against the live ACL, write, then re-read and verify (S10: never trust
 * the write). `stored` is the state this stack already holds (`output`); it is what adoption
 * lacks, and its absence is what makes the first plan a write. `self` is the connection's own
 * username — never managed, like `default`. */
export const reconcileWithExecutor = (
  executor: ValkeyExecutor,
  props: ValkeyAclFileProps,
  stored: ValkeyAclFileAttributes | undefined,
  env: Environment = process.env,
  self?: string,
  previous?: ValkeyAclFileProps,
): Effect.Effect<ValkeyAclFileAttributes, ValkeyError | ValkeyTransportError> =>
  Effect.gen(function* () {
    // ⛔ BEFORE ANY WRITE. The aclfile gate stands in front of the declaration refusals and the
    //   writes: on a rendered instance this family writes nothing at all, good or bad.
    const aclfile = yield* readAclFileConfig(executor);
    if (aclfile !== '') {
      return yield* Effect.fail(
        new ValkeyAclFileRendered({ instance: props.instance, path: aclfile }),
      );
    }

    // Declaration refusals (reserved names, split record key, seat prefix escapes, glob chars in
    // names, monitor-with-keyPrefix). Read hides `default` and the connection username, so a
    // declaration of either would otherwise look absent and `reset` the kit's own credential.
    const refused = refusalBeforeWrite(props.instance, props.users, self);
    if (refused !== undefined) return yield* Effect.fail(refused);

    // Resolve every declared password ONCE, at call time. A user the plan does not need to write
    // does not demand its variable — that is the `unknown` state, and it never drifts (diff).
    const refs: Record<string, FromEnv> = {};
    for (const [name, user] of Object.entries(props.users)) refs[name] = user.password;
    const { values } = resolveAll(refs, env);

    const live = yield* readParsedUsers(executor, self);
    const { create, update, remove, undeclared } = planAclUsers(
      props.users,
      live,
      props.exclusive,
      managedUserNames(stored, previous),
    );

    // Preserve-by-default (F1): never-managed users need exclusive ownership to be removed.
    // Previously managed users are revoked; `default`/`self` never appear in this live map.
    for (const name of undeclared) {
      yield* Effect.logWarning(
        `Valkey.AclFile "${props.instance}": live ACL user "${name}" is not declared; ${
          remove.includes(name)
            ? 'it is scheduled for deletion (previously managed or exclusive: true).'
            : 'it was left alone (exclusive: false).'
        }`,
      );
    }

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

    // ⛔ RUNTIME-ONLY. `reset`-first SETUSER per write; DELUSER for removed managed users or `exclusive`. No
    //   `ACL SAVE`: in the only mode this family writes (empty aclfile) it measurably errors on
    //   8.1.10. See the header note for the restart semantics that follow.
    for (const { user, password } of writeList) {
      const reply = yield* executor.send(yield* buildSetUserArgs(user, password));
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

    // Read back and verify: every declared user, exactly as declared (S10). Undeclared leftovers
    // fail under `exclusive` or when a previously managed user was scheduled for revocation.
    const after = yield* readParsedUsers(executor, self);
    for (const [name, user] of Object.entries(props.users)) {
      const parsed = after[name];
      if (parsed === undefined || !matchesDeclared(parsed, user)) {
        return yield* Effect.fail(
          new ValkeyAclReadbackFailed({ instance: props.instance, user: name }),
        );
      }
    }
    if (props.exclusive || remove.length > 0) {
      for (const name of Object.keys(after)) {
        if (props.users[name] === undefined && (props.exclusive || remove.includes(name))) {
          return yield* Effect.fail(
            new ValkeyAclReadbackFailed({ instance: props.instance, user: name }),
          );
        }
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
    return { instance: props.instance, users, managedUsers: Object.keys(props.users).sort() };
  });
