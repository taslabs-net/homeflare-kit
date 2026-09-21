/**
 * localCaddyAdmin: which addresses it accepts, the Host and Origin it sends (Caddy checks both),
 * the unix-socket path, and retrying only a connection nothing accepted.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaddyUnreachableError } from './admin.ts';
import { readRunningConfig } from './admin-calls.ts';
import { type FakeCaddy, fakeCaddy } from './fake-caddy.ts';
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
    expect(await readRunningConfig(admin)).toBeNull();
    const host = `127.0.0.1:${String(fake.port)}`;
    expect(fake.seen[0]?.headers.get('host')).toBe(host);
    expect(fake.seen[0]?.headers.get('origin')).toBe(`http://${host}`);
  });

  test('a narrowed `origins` needs hostHeader — without it Caddy answers 403', async () => {
    fake = fakeCaddy({ origins: ['caddy-admin.example:2019'] });
    const plain = localCaddyAdmin({ address: fake.address, retries: 0 });
    await expect(readRunningConfig(plain)).rejects.toThrow(/403: host not allowed/);
    const named = localCaddyAdmin({
      address: fake.address,
      hostHeader: 'caddy-admin.example:2019',
      retries: 0,
    });
    expect(await readRunningConfig(named)).toBeNull();
  });

  test('over a unix socket, with no Origin', async () => {
    const path = socketPath('req');
    fake = fakeCaddy({ running: { apps: {} }, unix: path });
    const admin = localCaddyAdmin({ address: fake.address, retries: 0 });
    expect(await readRunningConfig(admin)).toEqual({ apps: {} });
    expect(fake.seen[0]?.headers.has('origin')).toBe(false);
    rmSync(path, { force: true });
  });

  test('retries a socket nobody listens on yet, then reaches the Caddy that came up', async () => {
    const path = socketPath('late');
    const admin = localCaddyAdmin({ address: `unix://${path}`, retries: 5, retryDelayMs: 40 });
    const late = setTimeout(() => {
      fake = fakeCaddy({ unix: path });
    }, 60);
    expect(await readRunningConfig(admin)).toBeNull();
    clearTimeout(late);
    rmSync(path, { force: true });
  });

  test('gives up after the retries with CaddyUnreachableError, naming the address', async () => {
    const path = socketPath('never');
    const admin = localCaddyAdmin({ address: `unix://${path}`, retries: 1, retryDelayMs: 1 });
    const failure = readRunningConfig(admin);
    await expect(failure).rejects.toBeInstanceOf(CaddyUnreachableError);
    await expect(failure).rejects.toThrow(/Caddy admin GET \/config\/ at unix:\/\//);
  });
});
