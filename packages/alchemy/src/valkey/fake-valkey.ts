/**
 * A recording fake `ValkeyExecutor` (S28: tests use `bun:test`, and a test never trusts the
 * deploy's own report — here it reads back from the fake's own in-memory state, not from the
 * command list) for every lifecycle test in this family. No socket, no `node:net` — it is small
 * enough to re-derive the few commands this provider ever issues: `INFO`, `CONFIG GET`,
 * `ACL LIST`, `ACL SETUSER`, `ACL DELUSER`, `AUTH`, and `PING`, against an in-memory `config`
 * map and `acl` user map.
 *
 * ⛔ IT UNDERSTANDS EXACTLY THE COMMANDS THIS FAMILY ISSUES, NOT RESP IN GENERAL. A general RESP
 *   server would hide a protocol bug instead of tripping over it.
 */
import * as Effect from 'effect/Effect';
import { memoryBytes } from './instance-form.ts';
import type { ValkeyExecutor, ValkeyReply } from './transport.ts';
import type { ValkeyServerError } from './transport.ts';

export interface RecordedCommand {
  readonly args: ReadonlyArray<string>;
}

export interface FakeValkey extends ValkeyExecutor {
  readonly commands: ReadonlyArray<RecordedCommand>;
  /** Mutable on purpose: a test seeds a value a "competing" write would have produced before the
   * fake ever sees it. */
  readonly config: Map<string, string>;
  /** Mutable: the live ACL, keyed by username, value the `ACL LIST` line. */
  readonly acl: Map<string, string>;
  /** Which users the fake currently accepts an `AUTH` for (username → password). */
  readonly passwords: Map<string, string>;
}

export interface FakeValkeyOptions {
  readonly config?: Readonly<Record<string, string>>;
  readonly acl?: Readonly<Record<string, string>>;
  readonly passwords?: Readonly<Record<string, string>>;
  /** Fail the NEXT write (`ACL SETUSER`/`ACL DELUSER`) once, the way a concurrent mutator would. */
  readonly raceNextWrite?: boolean;
  /** Re-add this user after EVERY successful ACL write — a concurrent mutator that survives the
   * reconcile's writes, so the read-back (never the write reply) is what catches it. */
  readonly reAddAfterWrite?: { readonly name: string; readonly line: string };
  /** The version `INFO` reports — only the `redis_version:` line matters to `Instance`. */
  readonly version?: string;
  /** `INFO` `tcp_port`. Defaults to 0, the reply a server that omitted the line would give. */
  readonly port?: number;
}

/** Rebuild an `ACL LIST` line from a username and its fields — the fake stores the parsed fields,
 * and re-renders on `ACL LIST` so a test can assert on the exact user line the provider wrote. */
export const renderAclLine = (username: string, fields: Record<string, string>): string => {
  const parts = [`user ${username}`];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(value === '' ? key : `${key} ${value}`);
  }
  return parts.join(' ');
};

export const makeFakeValkey = (options: FakeValkeyOptions = {}): FakeValkey => {
  const commands: RecordedCommand[] = [];
  const config = new Map(Object.entries(options.config ?? {}));
  const acl = new Map(Object.entries(options.acl ?? {}));
  const passwords = new Map(Object.entries(options.passwords ?? {}));
  let raceRemaining = options.raceNextWrite === true ? 1 : 0;
  // A concurrent mutator: re-applied after EVERY successful ACL write, including the deletes,
  // so a write that "succeeded" can still lose to it and only the read-back tells the truth.
  const reAdd = options.reAddAfterWrite;
  const afterWrite = (): void => {
    if (reAdd !== undefined) acl.set(reAdd.name, reAdd.line);
  };

  const reply = (value: string | null | ReadonlyArray<string | null>): ValkeyReply =>
    typeof value === 'string' || value === null
      ? ({ kind: 'bulk', value } as const)
      : ({ kind: 'array', values: value } as const);

  const send = (args: ReadonlyArray<string>): Effect.Effect<ValkeyReply, ValkeyServerError> =>
    Effect.sync(() => {
      commands.push({ args });
      const [cmd, ...rest] = args;

      switch (cmd) {
        case 'PING':
          return reply('PONG');

        case 'AUTH': {
          const [user, pass] = rest;
          if (user === undefined || pass === undefined) {
            return { kind: 'error', message: 'ERR wrong number of arguments for AUTH' } as const;
          }
          const expected = passwords.get(user);
          if (expected === undefined || expected !== pass) {
            return { kind: 'error', message: 'WRONGPASS invalid username-password pair' } as const;
          }
          return reply('OK');
        }

        case 'INFO': {
          const version = options.version ?? '8.1.10';
          const port = options.port ?? 0;
          return reply(
            [
              '# Server',
              `redis_version:${version}`,
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
            return {
              kind: 'error',
              message: `ERR CONFIG ${rest[0]} not supported by fake`,
            } as const;
          }
          const want = rest.slice(1);
          const out: Array<string | null> = [];
          for (const key of want) {
            out.push(key);
            const raw = config.get(key) ?? null;
            // `CONFIG GET maxmemory` is `ull2string` of the byte count, not the unit form
            // the declaration (and a Quadlet `--maxmemory`) used.
            if (key === 'maxmemory' && raw !== null) {
              const bytes = memoryBytes(raw);
              out.push(bytes === undefined ? raw : String(bytes));
            } else {
              out.push(raw);
            }
          }
          return reply(out);
        }

        case 'ACL': {
          const sub = rest[0];
          if (sub === 'LIST') {
            return reply([...acl.entries()].map(([, line]) => line) as Array<string | null>);
          }
          if (sub === 'SETUSER') {
            if (raceRemaining > 0) {
              raceRemaining -= 1;
              return { kind: 'error', message: 'ERR fake race' } as const;
            }
            const username = rest[1];
            if (username === undefined) {
              return {
                kind: 'error',
                message: 'ERR wrong number of arguments for SETUSER',
              } as const;
            }
            // Rebuild from the rule parts; the fake keeps a simple string → string field map.
            const fieldMap: Record<string, string> = {};
            for (let i = 2; i < rest.length; i += 1) {
              const part = rest[i];
              if (part === undefined) continue;
              if (
                part.startsWith('~') ||
                part.startsWith('&') ||
                part.startsWith('>') ||
                part.startsWith('<') ||
                part.startsWith('+') ||
                part.startsWith('-') ||
                part === 'on' ||
                part === 'off' ||
                part === 'resetkeys' ||
                part === 'resetchannels' ||
                part === 'reset' ||
                part === 'nopass' ||
                part === 'allkeys' ||
                part === 'allchannels'
              ) {
                fieldMap[part] = '';
              } else {
                // Assume `key value`; we know the shape of our own SETUSER args.
                fieldMap[part] = rest[i + 1] ?? '';
                i += 1;
              }
            }
            acl.set(username, renderAclLine(username, fieldMap));
            afterWrite();
            return reply('OK');
          }
          if (sub === 'DELUSER') {
            if (raceRemaining > 0) {
              raceRemaining -= 1;
              return { kind: 'error', message: 'ERR fake race' } as const;
            }
            const removed = rest.slice(1).filter((u) => acl.delete(u)).length;
            afterWrite();
            return reply(String(removed));
          }
          return { kind: 'error', message: `ERR ACL ${sub} not supported by fake` } as const;
        }

        default:
          return { kind: 'error', message: `ERR unknown command '${cmd}'` } as const;
      }
    });

  return { send, commands, config, acl, passwords };
};
