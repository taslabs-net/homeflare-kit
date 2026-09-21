/**
 * CaddyConfig's lifecycle against the fake admin API (fake-caddy.ts): apply, a refused config
 * rolled back, drift, and the refusals that must happen before anything is sent.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import type { CaddyAdmin } from './admin.ts';
import { type FakeCaddy, fakeDefaultCaddy } from './fake-caddy.ts';
import { configDigest } from './digest.ts';
import { diffConfig, readLive, reconcileConfig } from './config-lifecycle.ts';

const SITE = 'app.example.com reverse_proxy 127.0.0.1:8080';
const OTHER = 'www.example.com respond <hello> & bye';

let fake: FakeCaddy | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});

/** A Caddy on its default :2019 (fake-caddy.ts fakeDefaultCaddy), stopped after each test. */
const setup = (running?: unknown) => {
  const made = fakeDefaultCaddy(running);
  fake = made.caddy;
  return made;
};

/** ★ These are the resource's own applies (it has state); config-adopt.test.ts covers a create. */
const OWNED = { takeOver: true } as const;

const loads = (caddy: FakeCaddy) => caddy.seen.filter((call) => call.path === '/load');

describe('apply', () => {
  test('loads the Caddyfile, reads it back, and stores the digest Caddy reports', async () => {
    const { admin, caddy } = setup();
    const applied = await reconcileConfig(admin, { caddyfile: OTHER }, OWNED);
    expect(applied.loaded).toBe(true);
    // ★ The fake's /config/ is sorted and escaped differently from /adapt; the digests still agree.
    expect(applied.attributes.configSha256).toBe(configDigest(caddy.adapt(OTHER)));
    expect(applied.attributes.endpoint).toBe(caddy.address);
    const [load] = loads(caddy);
    expect(load?.headers.get('content-type')).toBe('text/caddyfile');
    expect(load?.body).toBe(OTHER);
  });

  test('a Caddy already running this config is not reloaded', async () => {
    const { admin, caddy } = setup();
    await reconcileConfig(admin, { caddyfile: SITE }, OWNED);
    const again = await reconcileConfig(admin, { caddyfile: SITE }, OWNED);
    expect(again.loaded).toBe(false);
    expect(loads(caddy)).toHaveLength(1);
  });

  test('sourceFile rides as the headers `caddy reload` sends, and lands in the attributes', async () => {
    const { admin, caddy } = setup();
    const path = '/usr/local/etc/Caddyfile';
    const applied = await reconcileConfig(admin, { caddyfile: SITE, sourceFile: path }, OWNED);
    expect(loads(caddy)[0]?.headers.get('caddy-config-source-file')).toBe(path);
    expect(loads(caddy)[0]?.headers.get('caddy-config-source-adapter')).toBe('caddyfile');
    expect(applied.attributes.sourceFile).toBe(path);
  });

  test('adapter warnings are returned, not refused', async () => {
    const { admin } = setup();
    const applied = await reconcileConfig(admin, { caddyfile: `${SITE}\t` }, OWNED);
    expect(applied.warnings).toEqual(['Caddyfile:1: Caddyfile input is not formatted']);
  });
});

describe('a config Caddy refuses', () => {
  test('surfaces Caddy’s reason and confirms the previous config is still running', async () => {
    const { admin, caddy } = setup();
    await reconcileConfig(admin, { caddyfile: SITE }, OWNED);
    const before = caddy.running;
    await expect(
      reconcileConfig(admin, { caddyfile: `${SITE}\nPROVISION_ERROR` }, OWNED),
    ).rejects.toThrow(/address already in use.*kept the previous config/);
    expect(caddy.running).toEqual(before);
  });

  test('a refusal that came back as a 200 (warnings first) is still a refusal', async () => {
    const { admin, caddy } = setup();
    await reconcileConfig(admin, { caddyfile: SITE }, OWNED);
    await expect(
      reconcileConfig(admin, { caddyfile: `${SITE}\t\nPROVISION_ERROR` }, OWNED),
    ).rejects.toThrow(/→ 200: loading config.*error in a 200 body.*kept the previous/);
    expect(configDigest(caddy.running)).toBe(configDigest(caddy.adapt(SITE)));
  });

  test('a load answered 200 that Caddy did not apply fails the deploy (the read-back)', async () => {
    const { admin, caddy } = setup();
    await reconcileConfig(admin, { caddyfile: SITE }, OWNED);
    // ⚠️ A concurrent writer, or a 200 that carried no change: state must not record OTHER.
    const swallowing: CaddyAdmin = {
      ...admin,
      request: (call) =>
        call.path === '/load' ? Promise.resolve({ body: '', status: 200 }) : admin.request(call),
    };
    await expect(reconcileConfig(swallowing, { caddyfile: OTHER }, OWNED)).rejects.toThrow(
      /after the load Caddy runs config \w+, not the \w+ this Caddyfile adapts to/,
    );
    expect(configDigest(caddy.running)).toBe(configDigest(caddy.adapt(SITE)));
  });

  test('a Caddyfile that does not adapt is refused before any load', async () => {
    const { admin, caddy } = setup();
    await expect(reconcileConfig(admin, { caddyfile: 'SYNTAX_ERROR' }, OWNED)).rejects.toThrow(
      /\/adapt → 400: Caddyfile:1 - Error during parsing/,
    );
    expect(loads(caddy)).toHaveLength(0);
  });
});

describe('refused before anything is sent', () => {
  test.each([
    ['a literal token', 'example.com {\n  dns cloudflare abcdef0123456789\n}'],
    ['an empty Caddyfile', '  \n'],
  ])('%s', async (_, caddyfile) => {
    const { admin, caddy } = setup();
    await expect(reconcileConfig(admin, { caddyfile }, OWNED)).rejects.toThrow(
      /Caddy\.Config at http/,
    );
    expect(caddy.seen).toHaveLength(0);
  });

  test.each([
    ['only a comment', '# the template rendered nothing'],
    ['only global options', 'admin localhost:2019'],
  ])('a Caddyfile of %s adapts to no apps, and is never loaded', async (_, caddyfile) => {
    const { admin, caddy } = setup();
    await expect(reconcileConfig(admin, { caddyfile }, OWNED)).rejects.toThrow(/adapts to no apps/);
    expect(loads(caddy)).toHaveLength(0);
  });

  test('a Caddyfile that would turn the admin API off is never loaded', async () => {
    const { admin, caddy } = setup();
    await expect(
      reconcileConfig(admin, { caddyfile: `admin off\n${SITE}` }, OWNED),
    ).rejects.toThrow(/admin off/);
    expect(loads(caddy)).toHaveLength(0);
  });
});

describe('drift', () => {
  const applied = async () => {
    const { admin, caddy } = setup();
    const { attributes } = await reconcileConfig(admin, { caddyfile: SITE }, OWNED);
    return { admin, attributes, caddy };
  };

  test('converged: declared, live and stored agree → noop', async () => {
    const { admin, attributes } = await applied();
    expect(await diffConfig(admin, { caddyfile: SITE }, attributes)).toEqual({ action: 'noop' });
  });

  test('a changed declaration → update', async () => {
    const { admin, attributes } = await applied();
    expect(await diffConfig(admin, { caddyfile: OTHER }, attributes)).toEqual({ action: 'update' });
  });

  test('a hand edit through the API → update, and the apply puts the declaration back', async () => {
    const { admin, attributes, caddy } = await applied();
    caddy.running = { apps: { http: { servers: {} } } };
    expect(await diffConfig(admin, { caddyfile: SITE }, attributes)).toEqual({ action: 'update' });
    const again = await reconcileConfig(admin, { caddyfile: SITE }, OWNED);
    expect(again.attributes.configSha256).toBe(attributes.configSha256);
  });

  test('a restart with a different file → update', async () => {
    const { admin, attributes, caddy } = await applied();
    caddy.running = JSON.parse(JSON.stringify(caddy.adapt(OTHER))) as unknown;
    expect((await readLive(admin)).configSha256).not.toBe(attributes.configSha256);
    expect(await diffConfig(admin, { caddyfile: SITE }, attributes)).toEqual({ action: 'update' });
  });

  test('state that lags the live config → update, so the stored digest is refreshed', async () => {
    const { admin, attributes } = await applied();
    const stale = { ...attributes, configSha256: configDigest({ apps: { before: true } }) };
    expect(await diffConfig(admin, { caddyfile: SITE }, stale)).toEqual({ action: 'update' });
  });

  test('the transport now reaches Caddy at another endpoint → update (load there)', async () => {
    const { admin, attributes } = await applied();
    const moved = { ...attributes, endpoint: 'unix:///run/caddy/admin.sock' };
    expect(await diffConfig(admin, { caddyfile: SITE }, moved)).toEqual({ action: 'update' });
  });

  test('a new sourceFile → update, so state records the file this config mirrors', async () => {
    const { admin, attributes } = await applied();
    const diff = await diffConfig(
      admin,
      { caddyfile: SITE, sourceFile: '/etc/Caddyfile' },
      attributes,
    );
    expect(diff).toEqual({ action: 'update' });
  });
});
