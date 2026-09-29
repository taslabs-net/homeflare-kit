/**
 * The scratch stores the state tests run against, and what happens when one is missing.
 *
 * ⛔ A MISSING STORE SKIPS ITS SUITE LOUDLY, AND `SEAT_RUNTIME_REQUIRE_SERVERS=1` MAKES IT FAIL.
 *   `bun run check` runs in CI on `ubuntu-latest`, which has no `valkey-server` and no scratch
 *   Postgres, so a suite that hard-failed there would block every PR, and one that skipped
 *   silently would go green forever with nothing behind it. Bun prints skipped tests; a human
 *   run that means to prove the layers sets the variable (README, "Development").
 * ★ VALKEY IS STARTED HERE, ON A LOOPBACK PORT, WITH THE ACL THE SEATS WILL HAVE: `user default
 *   off` and one `seat` user restricted to the `seat:*` key prefix (the scout's measured shape,
 *   2026-09-29). The password is made per run and never written anywhere but the instance's own
 *   ACL file, in a directory removed at the end.
 * ★ POSTGRES IS NOT STARTED HERE: a scratch database is somebody's to create and drop, so the
 *   tests read its URL from `SEAT_RUNTIME_TEST_POSTGRES_URL` and touch only tables they make.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const REQUIRE_SERVERS: boolean = Bun.env['SEAT_RUNTIME_REQUIRE_SERVERS'] === '1';
export const VALKEY_BINARY: string | null = Bun.which('valkey-server') ?? Bun.which('redis-server');
export const POSTGRES_URL: string | undefined = Bun.env['SEAT_RUNTIME_TEST_POSTGRES_URL'];

/** `describe` when the store is there, a failing placeholder when it is required, else a skip. */
export function suiteWith(available: boolean, what: string, body: () => void): void {
  if (available) return describe(what, body);
  if (REQUIRE_SERVERS) {
    return describe(what, () =>
      test('the store this suite needs is available', () => {
        expect.unreachable(`${what}: not available, and SEAT_RUNTIME_REQUIRE_SERVERS=1`);
      }),
    );
  }
  return describe.skip(`${what} (not available here)`, body);
}

/** A loopback port nothing holds right now. Loopback, never the wildcard (tests/loopback-servers). */
export function freePort(): number {
  const probe = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const { port } = probe;
  probe.stop(true);
  return port;
}

export type ScratchValkey = {
  readonly port: number;
  /** The seat user's URL: `redis://seat:<password>@127.0.0.1:<port>`. */
  readonly seatUrl: string;
  /** The same server with no credentials, which `user default off` refuses. */
  readonly anonymousUrl: string;
  /** The seat user's URL with the right user and a wrong password. */
  readonly wrongPasswordUrl: string;
  /** The seat user's password, for the assertion that it never leaves. */
  readonly password: string;
  /** The one key prefix the seat user may touch. */
  readonly prefix: 'seat:';
  /** Kill the server and leave it down, on the same port. */
  readonly kill: () => Promise<void>;
  /** Kill it and start it again on the same port with the same ACL. */
  readonly restart: () => Promise<void>;
  /** Kill it and remove its directory. */
  readonly stop: () => Promise<void>;
};

async function listening(port: number): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await Bun.connect({
        hostname: '127.0.0.1',
        port,
        socket: {
          data() {},
          open(socket) {
            socket.end();
          },
        },
      });
      return true;
    } catch {
      await Bun.sleep(50);
    }
  }
  return false;
}

type Spawned = { readonly proc: Bun.Subprocess; readonly up: boolean };

/** One `valkey-server` on `port` with `acl`; `up` is whether it is listening and still running. */
async function spawnValkey(port: number, acl: string, dir: string): Promise<Spawned> {
  const proc = Bun.spawn(
    [
      VALKEY_BINARY ?? '',
      '--port',
      String(port),
      '--bind',
      '127.0.0.1',
      '--aclfile',
      acl,
      '--save',
      '',
      '--appendonly',
      'no',
      '--dir',
      dir,
    ],
    { stdout: 'ignore', stderr: 'ignore' },
  );
  return { proc, up: (await listening(port)) && proc.exitCode === null };
}

export async function startValkey(): Promise<ScratchValkey> {
  if (VALKEY_BINARY === null) throw new Error('no valkey-server or redis-server on PATH');
  const dir = await mkdtemp(join(tmpdir(), 'seat-runtime-valkey-'));
  const password = crypto.randomUUID();
  const acl = join(dir, 'users.acl');
  await writeFile(acl, `user default off\nuser seat on >${password} ~seat:* +@all -@dangerous\n`);
  // ⚠️ The port is chosen, released and then bound by the server: another process could take it
  //   in between, so a start that dies is retried on a new port.
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = freePort();
    let current = await spawnValkey(port, acl, dir);
    if (!current.up) {
      current.proc.kill();
      continue;
    }
    const kill = async (): Promise<void> => {
      current.proc.kill();
      await current.proc.exited;
    };
    return {
      port,
      seatUrl: `redis://seat:${password}@127.0.0.1:${String(port)}`,
      anonymousUrl: `redis://127.0.0.1:${String(port)}`,
      wrongPasswordUrl: `redis://seat:wrong-${password}@127.0.0.1:${String(port)}`,
      password,
      prefix: 'seat:',
      kill,
      restart: async () => {
        await kill();
        current = await spawnValkey(port, acl, dir);
        if (!current.up) throw new Error('valkey-server did not come back on its port');
      },
      stop: async () => {
        await kill();
        await rm(dir, { recursive: true, force: true });
      },
    };
  }
  await rm(dir, { recursive: true, force: true });
  throw new Error('valkey-server did not start on any of 5 ports');
}
