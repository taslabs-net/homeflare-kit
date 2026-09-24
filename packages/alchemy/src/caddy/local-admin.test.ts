/**
 * localCaddyAdmin: which addresses it accepts, the Host and Origin it sends (Caddy checks both),
 * the unix-socket path, and retrying only a connection nothing accepted.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as HttpClientError from 'effect/unstable/http/HttpClientError';
import { loadCaddyfile, readRunningConfig } from './admin-calls.ts';
import { isUnreachable } from './caddy-http-client.ts';
import { type FakeCaddy, fakeCaddy, runCaddy } from './fake-caddy.ts';
import { DEFAULT_ADMIN_ADDRESS, localCaddyAdmin, parseAdminAddress } from './local-admin.ts';

let fake: FakeCaddy | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});

/** ⚠️ Short on purpose: macOS caps a socket path at 104 bytes, and node then fails EINVAL. */
const socketPath = (label: string) => {
  const path = join(tmpdir(), `fc-${label}-${String(process.pid)}.sock`);
  rmSync(path, { force: true });
  return path;
};

describe('parseAdminAddress', () => {
  test("the default is Caddy's own default listener, over loopback TCP", () => {
    expect(DEFAULT_ADMIN_ADDRESS).toBe('http://127.0.0.1:2019');
    expect(parseAdminAddress(DEFAULT_ADMIN_ADDRESS).listener).toEqual({
      hostHeader: '127.0.0.1:2019',
      kind: 'tcp',
      port: 2019,
    });
  });

  test.each(['http://localhost:2019', 'http://[::1]:2019', 'http://127.0.0.2:2020'])(
    'accepts loopback %s',
    (address) => {
      expect(parseAdminAddress(address).listener.kind).toBe('tcp');
    },
  );

  test('a unix socket, which Caddy exempts from the Host check', () => {
    expect(parseAdminAddress('unix:///run/caddy/admin.sock').listener).toEqual({
      kind: 'unix',
      path: '/run/caddy/admin.sock',
    });
  });

  test.each([
    ['http://192.0.2.10:2019', /not loopback/],
    ['http://caddy.example.com:2019', /not loopback/],
    ['https://127.0.0.1:2019', /only http/],
    ['http://127.0.0.1:2019/config', /no path/],
    ['http://user:pw@127.0.0.1:2019', /credentials/],
    ['unix://relative.sock', /absolute/],
    ['127.0.0.1:2019', /not a URL|only http/],
  ])('refuses %s', (address, reason) => {
    expect(() => parseAdminAddress(address)).toThrow(reason);
  });

  test('the Host always carries the port, as Caddy compares host:port (a default port too)', () => {
    expect(parseAdminAddress('http://127.0.0.1').listener).toEqual({
      hostHeader: '127.0.0.1:80',
      kind: 'tcp',
      port: 80,
    });
    expect(parseAdminAddress('http://[::1]:2019').listener).toMatchObject({
      hostHeader: '[::1]:2019',
    });
  });

  test('hostHeader is what Caddy checks: its port is the listener port, not the dialled one', () => {
    const parsed = parseAdminAddress('http://127.0.0.1:12019', '127.0.0.1:2019');
    expect(parsed.listener).toEqual({ hostHeader: '127.0.0.1:2019', kind: 'tcp', port: 2019 });
    expect(() => parseAdminAddress('http://127.0.0.1:2019', 'no port')).toThrow(/host:port/);
  });
});

describe('requests', () => {
  test('over TCP: Host and Origin as the Caddy CLI sends them, so the checks pass', async () => {
    fake = fakeCaddy();
    const admin = localCaddyAdmin({ address: fake.address, retries: 0 });
    expect(await runCaddy(readRunningConfig(), admin)).toBeNull();
    const host = `127.0.0.1:${String(fake.port)}`;
    expect(fake.seen[0]?.headers.get('host')).toBe(host);
    expect(fake.seen[0]?.headers.get('origin')).toBe(`http://${host}`);
  });

  test('a narrowed `origins` needs hostHeader — without it Caddy answers 403', async () => {
    fake = fakeCaddy({ origins: ['caddy-admin.example:2019'] });
    const plain = localCaddyAdmin({ address: fake.address, retries: 0 });
    await expect(runCaddy(readRunningConfig(), plain)).rejects.toThrow(/host not allowed/);
    const named = localCaddyAdmin({
      address: fake.address,
      hostHeader: 'caddy-admin.example:2019',
      retries: 0,
    });
    expect(await runCaddy(readRunningConfig(), named)).toBeNull();
  });

  test("an operation's own headers never override the Host and Origin the checks depend on", async () => {
    // ⚠️ There is no raw `.request()` anymore for a caller to hand Host/Origin to — every header
    //   an operation sends of its own (loadConfig's Content-Type, Cache-Control, …) is set by
    //   distilled's `buildRequest` from the SCHEMA, never by a caller, and Host/Origin are set by
    //   `CaddyProtocol.encode` from `Credentials` alone, unconditionally, after that — so the same
    //   invariant now holds by construction rather than by a check in this transport.
    fake = fakeCaddy();
    const admin = localCaddyAdmin({ address: fake.address, retries: 0 });
    await runCaddy(loadCaddyfile('respond ok'), admin);
    const host = `127.0.0.1:${String(fake.port)}`;
    const load = fake.seen.find((call) => call.path === '/load');
    expect(load?.headers.get('host')).toBe(host);
    expect(load?.headers.get('origin')).toBe(`http://${host}`);
  });

  test('over a unix socket', async () => {
    const path = socketPath('req');
    fake = fakeCaddy({ running: { apps: {} }, unix: path });
    const admin = localCaddyAdmin({ address: fake.address, retries: 0 });
    expect(await runCaddy(readRunningConfig(), admin)).toEqual({ apps: {} });
    // ⚠️ MEASURED 2026-09-23: `@distilled.cloud/caddy`'s `CaddyProtocol.encode` sends Host AND
    //   Origin on every call, unconditionally — unlike the old hand-rolled transport, which sent
    //   no Origin over a unix socket (Caddy's own CLI doesn't either). Caddy skips the Host check
    //   entirely on unix listeners either way (admin.go allowedOrigins), so this changes nothing
    //   the default (no `enforce_origin`) fake or a real unix-socket Caddy checks.
    expect(fake.seen[0]?.headers.get('host')).toBe('127.0.0.1');
    expect(fake.seen[0]?.headers.get('origin')).toBe('http://127.0.0.1');
    rmSync(path, { force: true });
  });

  test('retries a socket nobody listens on yet, then reaches the Caddy that came up', async () => {
    const path = socketPath('late');
    const admin = localCaddyAdmin({ address: `unix://${path}`, retries: 5, retryDelayMs: 40 });
    const late = setTimeout(() => {
      fake = fakeCaddy({ unix: path });
    }, 60);
    expect(await runCaddy(readRunningConfig(), admin)).toBeNull();
    clearTimeout(late);
    rmSync(path, { force: true });
  });

  test('a connection that was ACCEPTED is never re-sent, however many retries remain', async () => {
    // ⛔ It may have reached Caddy: re-sending a `POST /load` could apply it twice.
    let accepted = 0;
    const server = createServer((socket) => {
      accepted += 1;
      socket.on('data', () => socket.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const admin = localCaddyAdmin({
      address: `http://127.0.0.1:${String(port)}`,
      retries: 3,
      retryDelayMs: 1,
    });
    const failure = runCaddy(loadCaddyfile('respond ok'), admin);
    await expect(failure).rejects.toBeInstanceOf(HttpClientError.HttpClientError);
    await expect(failure.catch((error: unknown) => isUnreachable(error))).resolves.toBe(false);
    expect(accepted).toBe(1);
    server.close();
  });

  test('gives up after the retries, still narrowable as unreachable, naming the address', async () => {
    const path = socketPath('never');
    const admin = localCaddyAdmin({ address: `unix://${path}`, retries: 1, retryDelayMs: 1 });
    const failure = runCaddy(readRunningConfig(), admin);
    await expect(failure).rejects.toBeInstanceOf(HttpClientError.HttpClientError);
    await expect(failure.catch((error: unknown) => isUnreachable(error))).resolves.toBe(true);
  });
});
