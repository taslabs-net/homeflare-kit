/**
 * A recording fake `ValkeyExecutor` that answers the way a REAL valkey 8.1.10 answers, not the
 * way this family's code writes (S28: tests read back from the fake's own in-memory state, not
 * from the command list). No socket, no `node:net` — it re-derives exactly the commands this
 * family ever issues (`INFO`, `CONFIG GET`, `AUTH`, `ACL LIST/SETUSER/DELUSER/SAVE`, `PING`,
 * `PUBLISH`) against per-user ACL state, with the echo and error shapes MEASURED against a
 * disposable 8.1.10 scratch container (2026-09-30):
 *
 * ★ `ACL LIST` echoes the server's normalised form, not the SETUSER argument list: the `reset`
 *   baseline appears as an explicit `-@all` token (cancelled only by `+@all`), `allchannels`
 *   echoes as `&*`, an empty channel list echoes the bare `resetchannels` marker, `reset` and
 *   the password VALUE are dropped (only the `#<sha256>` hash echoes).
 * ★ `AUTH` compares the sha256 of the presented password and refuses with the measured
 *   WRONGPASS text; `PUBLISH` refuses by CHANNEL with the measured NOPERM text.
 * ★ `ACL SAVE` errors with the measured "not configured to use an ACL file" text while no
 *   `aclfile` is configured — which is why the write path never calls it — and answers `OK`
 *   once `config.aclfile` names a writable file.
 */
import {
  type FakeAclUser,
  applyToken,
  channelAllowed,
  freshUser,
  renderUser,
  seedUser,
  sha256,
} from './fake-acl.ts';
import * as Effect from 'effect/Effect';
import { memoryBytes } from './instance-form.ts';
import type { ValkeyExecutor, ValkeyReply, ValkeyServerError } from './transport.ts';

export interface RecordedCommand {
  readonly args: ReadonlyArray<string>;
}

export interface FakeValkey extends ValkeyExecutor {
  readonly commands: ReadonlyArray<RecordedCommand>;
  /** Mutable on purpose: a test seeds a value a "competing" write would have produced before
   * the fake ever sees it. The `aclfile` entry is what `CONFIG GET aclfile` answers. */
  readonly config: Map<string, string>;
  /** The live ACL as `ACL LIST` echoes it, keyed by username — the fake's own report, not the
   * command list (S28). */
  readonly acl: Map<string, string>;
  /** Which usernames the fake accepts an `AUTH` for, and at which plaintext (test fixtures). */
  readonly passwords: Map<string, string>;
}

export interface FakeValkeyOptions {
  readonly config?: Readonly<Record<string, string>>;
  /** Seed users as `ACL LIST` lines, parsed with the same tokenizer as SETUSER. */
  readonly acl?: Readonly<Record<string, string>>;
  readonly passwords?: Readonly<Record<string, string>>;
  /** Fail the NEXT write (`ACL SETUSER`/`ACL DELUSER`) once, the way a concurrent mutator would. */
  readonly raceNextWrite?: boolean;
  /** Re-add this user after EVERY successful ACL write — a concurrent mutator that survives the
   * reconcile's writes, so the read-back (never the write reply) is what catches it. */
  readonly reAddAfterWrite?: { readonly name: string; readonly line: string };
  /** The version `INFO` reports as `valkey_version` (with a `redis_version` fallback line). */
  readonly version?: string;
  /** `INFO` `tcp_port`. Defaults to 0, the reply a server that omitted the line would give. */
  readonly port?: number;
}

export const makeFakeValkey = (options: FakeValkeyOptions = {}): FakeValkey => {
  const commands: RecordedCommand[] = [];
  const config = new Map(Object.entries({ aclfile: '', ...options.config }));
  const users = new Map<string, FakeAclUser>(
    Object.entries(options.acl ?? {}).map(([name, line]) => [name, seedUser(line)]),
  );
  const passwords = new Map(Object.entries(options.passwords ?? {}));
  const acl = new Map<string, string>();
  const resync = (): void => {
    acl.clear();
    for (const [name, user] of users) acl.set(name, renderUser(name, user));
  };
  resync();
  let raceRemaining = options.raceNextWrite === true ? 1 : 0;
  const reAdd = options.reAddAfterWrite;
  const afterWrite = (): void => {
    if (reAdd !== undefined) {
      users.set(reAdd.name, seedUser(reAdd.line));
      resync();
    }
  };
  let session = 'default';

  const reply = (value: string | null | ReadonlyArray<string | null>): ValkeyReply =>
    typeof value === 'string' || value === null
      ? ({ kind: 'bulk', value } as const)
      : ({ kind: 'array', values: value } as const);
  const error = (message: string): ValkeyReply => ({ kind: 'error', message }) as const;

  const send = (args: ReadonlyArray<string>): Effect.Effect<ValkeyReply, ValkeyServerError> =>
    Effect.sync(() => {
      commands.push({ args });
      users.clear();
      for (const [name, line] of acl) users.set(name, seedUser(line));
      const [cmd, ...rest] = args;

      switch (cmd) {
        case 'PING':
          return reply('PONG');

        case 'AUTH': {
          const [user, pass] = rest.length > 1 ? rest : ['default', rest[0]];
          if (pass === undefined) {
            return error('ERR wrong number of arguments for AUTH');
          }
          const known = users.get(user ?? 'default');
          const configured = passwords.get(user ?? 'default');
          const ok =
            known !== undefined
              ? known.on && (known.nopass || known.passwords.includes(`#${sha256(pass)}`))
              : configured !== undefined && configured === pass;
          if (!ok) return error('WRONGPASS invalid username-password pair or user is disabled.');
          session = user ?? 'default';
          return reply('OK');
        }

        case 'INFO': {
          const version = options.version ?? '8.1.10';
          const port = options.port ?? 0;
          return reply(
            [
              '# Server',
              `valkey_version:${version}`,
              'redis_version:7.2.4',
              'redis_mode:standalone',
              `tcp_port:${String(port)}`,
              '# Persistence',
              'loading:0',
              '# Keyspace',
            ].join('\r\n'),
          );
        }

        case 'CONFIG': {
          if (rest[0] !== 'GET') {
            return error(`ERR CONFIG ${rest[0]} not supported by fake`);
          }
          const out: Array<string | null> = [];
          for (const key of rest.slice(1)) {
            const raw = config.get(key);
            if (raw === undefined) continue; // a real server omits keys it has no answer for
            out.push(key);
            if (key === 'maxmemory') {
              const bytes = memoryBytes(raw);
              out.push(bytes === undefined ? raw : String(bytes));
            } else {
              out.push(raw);
            }
          }
          return reply(out);
        }

        case 'PUBLISH': {
          const [channel] = rest;
          const me = users.get(session);
          if (me === undefined || session === 'default') return reply('0');
          const mayRun = me.rules.includes('+@all') || me.rules.includes('+@pubsub');
          if (!mayRun) {
            return error(`NOPERM User ${session} has no permissions to run the 'publish' command`);
          }
          if (!channelAllowed(me, channel ?? '')) {
            return error('NOPERM No permissions to access a channel');
          }
          return reply('0');
        }

        case 'ACL': {
          const sub = rest[0];
          if (sub === 'LIST') {
            return reply([...acl.values()] as Array<string | null>);
          }
          if (sub === 'SETUSER') {
            if (raceRemaining > 0) {
              raceRemaining -= 1;
              return error('ERR fake race');
            }
            const username = rest[1];
            if (username === undefined) {
              return error('ERR wrong number of arguments for SETUSER');
            }
            const user = users.get(username) ?? freshUser();
            for (const token of rest.slice(2)) applyToken(user, token);
            users.set(username, user);
            resync();
            afterWrite();
            return reply('OK');
          }
          if (sub === 'DELUSER') {
            if (raceRemaining > 0) {
              raceRemaining -= 1;
              return error('ERR fake race');
            }
            let removed = 0;
            for (const name of rest.slice(1)) {
              if (users.delete(name)) removed += 1;
            }
            resync();
            afterWrite();
            return reply(String(removed));
          }
          if (sub === 'SAVE') {
            if ((config.get('aclfile') ?? '') === '') {
              return error(
                'ERR This instance is not configured to use an ACL file. You may want to ' +
                  'specify users via the ACL SETUSER command and then issue a CONFIG REWRITE ' +
                  '(assuming you have a configuration file set) in order to store users in the ' +
                  'configuration.',
              );
            }
            return reply('OK');
          }
          return error(`ERR ACL ${sub} not supported by fake`);
        }

        default:
          return error(`ERR unknown command '${cmd}'`);
      }
    });

  return { send, commands, config, acl, passwords };
};
