/**
 * Ownership with no state — decision 2026-09-21: CaddyConfig never adopts silently. The adoption
 * probe (`read` with no output) and the apply of a create the engine never probed must agree on
 * what is claimable: the declared config itself, or a Caddy serving nothing. Anything else is
 * `Unowned` at plan time and refused at apply, unless the deploy runs with `--adopt` — and state
 * lends authority only over the Caddy it was applied to.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { AdoptPolicy, Unowned } from 'alchemy/AdoptPolicy';
import { AlchemyContext } from 'alchemy/AlchemyContext';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { type CaddyAdmin, CaddyUnreachableError, caddyAdminLayer } from './admin.ts';
import { CaddyConfig, CaddyConfigProvider } from './config.ts';
import { probeLive, reconcileConfig } from './config-lifecycle.ts';
import { configDigest } from './digest.ts';
import { type FakeCaddy, fakeDefaultCaddy } from './fake-caddy.ts';

const SITE = 'app.example.com reverse_proxy 127.0.0.1:8080';
/** A config someone else loaded: it serves a site, and it is not what the stack declares. */
const FOREIGN = { apps: { http: { servers: { legacy: { listen: [':80'] } } } } };
const ids = { fqn: 'stack/caddy', id: 'caddy', instanceId: 'i-1' };

let fake: FakeCaddy | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});

const setup = (running?: unknown) => {
  const made = fakeDefaultCaddy(running);
  fake = made.caddy;
  return made;
};

/** A Caddy already running the declared config — as one started from caddyWithFile's file is. */
const runningDeclared = () => {
  const made = setup();
  made.caddy.running = made.caddy.adapt(SITE);
  return made;
};

const loads = (caddy: FakeCaddy) => caddy.seen.filter((call) => call.path === '/load');

describe('the probe: read with no state', () => {
  test('a Caddy already running the declared config is ours — adopting it changes nothing', async () => {
    const { admin, caddy } = runningDeclared();
    const probe = await probeLive(admin, SITE);
    expect(probe).toMatchObject({ attributes: { configSha256: configDigest(caddy.adapt(SITE)) } });
    expect(probe?.ours).toBe(true);
    expect(loads(caddy)).toHaveLength(0);
  });

  test('a Caddy running any other config is not ours', async () => {
    const { admin } = setup(FOREIGN);
    const probe = await probeLive(admin, SITE, '/usr/local/etc/Caddyfile');
    expect(probe?.ours).toBe(false);
    expect(probe?.unchecked).toBeUndefined();
    expect(probe?.attributes).toEqual({
      configSha256: configDigest(FOREIGN),
      endpoint: fake?.address ?? '',
      sourceFile: '/usr/local/etc/Caddyfile',
    });
  });

  test.each([
    ['no config at all', null],
    ['only an admin block', { admin: { listen: 'localhost:2019' } }],
  ])('a Caddy serving nothing (%s) reads as absent: a create', async (_, running) => {
    const { admin } = setup(running);
    expect(await probeLive(admin, SITE)).toBeUndefined();
  });

  test.each([
    ['does not adapt', 'SYNTAX_ERROR', /Error during parsing/],
    ['is not plain text (a stripped Output)', undefined, /not plain text/],
  ])('a declaration that %s is not ours — and never fails the read', async (_, text, reason) => {
    // ⛔ The engine replays this read with an interrupted create's props: a throw here would fail
    //   every later plan, the one carrying the fix included.
    const { admin } = setup(FOREIGN);
    const probe = await probeLive(admin, text);
    expect(probe?.ours).toBe(false);
    expect(probe?.unchecked).toMatch(reason);
  });

  test('Caddy vanishing mid-probe stays "no Caddy", never "not ours"', async () => {
    const { admin } = setup(FOREIGN);
    const flaky: CaddyAdmin = {
      ...admin,
      request: (call) =>
        call.path === '/adapt'
          ? Promise.reject(new CaddyUnreachableError('gone'))
          : admin.request(call),
    };
    await expect(probeLive(flaky, SITE)).rejects.toThrow('gone');
  });
});

/** A create the engine never probed, or state from another endpoint (config.ts decides which). */
describe('the apply without authority over the running config', () => {
  test('without authority, a config the stack cannot claim is refused before any load', async () => {
    const { admin, caddy } = setup(FOREIGN);
    await expect(reconcileConfig(admin, { caddyfile: SITE }, { takeOver: false })).rejects.toThrow(
      /which this stack did not load.*Deploy with --adopt/,
    );
    expect(loads(caddy)).toHaveLength(0);
    expect(caddy.running).toEqual(FOREIGN);
  });

  test('the declared config already running is taken as it is — no load', async () => {
    const { admin, caddy } = runningDeclared();
    const applied = await reconcileConfig(admin, { caddyfile: SITE }, { takeOver: false });
    expect(applied.loaded).toBe(false);
    expect(loads(caddy)).toHaveLength(0);
  });

  test('a Caddy serving nothing is loaded — there is nothing to take over', async () => {
    const { admin, caddy } = setup();
    const applied = await reconcileConfig(admin, { caddyfile: SITE }, { takeOver: false });
    expect(applied.loaded).toBe(true);
    expect(configDigest(caddy.running)).toBe(configDigest(caddy.adapt(SITE)));
  });

  test('the config the state last stored is known — the same Caddy at a new endpoint', async () => {
    const { admin } = setup(FOREIGN);
    const authority = { stored: configDigest(FOREIGN), takeOver: false };
    expect((await reconcileConfig(admin, { caddyfile: SITE }, authority)).loaded).toBe(true);
  });

  test('with authority, the foreign config is replaced', async () => {
    const { admin, caddy } = setup(FOREIGN);
    const applied = await reconcileConfig(admin, { caddyfile: SITE }, { takeOver: true });
    expect(applied.loaded).toBe(true);
    expect(configDigest(caddy.running)).toBe(configDigest(caddy.adapt(SITE)));
  });
});

type Deploy = { readonly adopt?: boolean; readonly contextAdopt?: boolean };

/** The provider over `admin`, run under the services a deploy provides (the CLI's `--adopt`). */
const withProvider = <A>(
  admin: CaddyAdmin,
  deploy: Deploy,
  use: (p: Effect.Success<typeof CaddyConfig.Provider>) => Effect.Effect<A, unknown>,
) => {
  let program = Effect.gen(function* () {
    return yield* use(yield* CaddyConfig.Provider);
  }).pipe(Effect.provide(CaddyConfigProvider().pipe(Layer.provide(caddyAdminLayer(admin)))));
  if (deploy.adopt !== undefined) {
    program = program.pipe(Effect.provideService(AdoptPolicy, deploy.adopt));
  }
  if (deploy.contextAdopt !== undefined) {
    const context = { adopt: deploy.contextAdopt, dev: false, dotAlchemy: '.alchemy' };
    program = program.pipe(Effect.provideService(AlchemyContext, context));
  }
  return Effect.runPromise(program);
};

const read = (admin: CaddyAdmin, caddyfile: unknown, output?: object) =>
  withProvider(admin, {}, (provider) => {
    if (provider.read === undefined) throw new Error('provider has no read handler');
    return provider.read({ ...ids, olds: { caddyfile } as never, output: output as never });
  });

/** Apply, then check that exactly the expected loads reached Caddy — or none, and why. */
const expectApply = async (applying: Promise<unknown>, caddy: FakeCaddy, loaded: boolean) => {
  if (loaded) await applying;
  else await expect(applying).rejects.toThrow(/Deploy with --adopt/);
  expect(loads(caddy)).toHaveLength(loaded ? 1 : 0);
};

const reconcile = (admin: CaddyAdmin, deploy: Deploy, output?: object) =>
  withProvider(admin, deploy, (provider) =>
    provider.reconcile({
      ...ids,
      bindings: [] as never,
      news: { caddyfile: SITE },
      olds: undefined,
      output: output as never,
      session: undefined as never,
    }),
  );

describe('CaddyConfigProvider', () => {
  test('read: Unowned with no state, plain with state, plain when it is the declared config', async () => {
    const { admin, caddy } = setup(FOREIGN);
    const probe = await read(admin, SITE);
    expect(Unowned.is(probe)).toBe(true);
    expect(probe).toMatchObject({ configSha256: configDigest(FOREIGN) });
    const owned = await read(admin, SITE, { configSha256: 'stored', endpoint: caddy.address });
    expect(owned).toBeDefined();
    expect(Unowned.is(owned)).toBe(false);
    caddy.running = caddy.adapt(SITE);
    const same = await read(admin, SITE);
    expect(same).toBeDefined();
    expect(Unowned.is(same)).toBe(false);
  });

  test('read with no state: nothing served is a create; an unreadable declaration is Unowned', async () => {
    expect(await read(setup().admin, SITE)).toBeUndefined();
    fake?.stop();
    const { admin } = setup(FOREIGN);
    expect(Unowned.is(await read(admin, 'SYNTAX_ERROR'))).toBe(true);
    expect(Unowned.is(await read(admin, {}))).toBe(true);
  });

  test.each([
    ['no adopt setting at all', {}, false],
    ['AdoptPolicy off', { adopt: false }, false],
    ['--adopt (AdoptPolicy)', { adopt: true }, true],
    ['--adopt reaching only AlchemyContext', { contextAdopt: true }, true],
    ['AdoptPolicy off over AlchemyContext on', { adopt: false, contextAdopt: true }, false],
  ] as const)('reconcile with no state, %s', async (_, deploy, loaded) => {
    const { admin, caddy } = setup(FOREIGN);
    await expectApply(reconcile(admin, deploy), caddy, loaded);
  });

  test('reconcile with state for this Caddy loads over anything, without --adopt', async () => {
    // ★ An update correcting drift (a hand edit since the stored digest), or an adopted create.
    const { admin, caddy } = setup(FOREIGN);
    const output = { configSha256: 'before-a-hand-edit', endpoint: caddy.address };
    await expectApply(reconcile(admin, {}, output), caddy, true);
  });

  test.each([
    ['a config it never stored, without --adopt', 'stored-elsewhere', {}, false],
    ['a config it never stored, with --adopt', 'stored-elsewhere', { adopt: true }, true],
    ['the config it last stored (the same Caddy, renamed)', configDigest(FOREIGN), {}, true],
  ] as const)('reconcile with state from another endpoint: %s', async (_, sha, deploy, loaded) => {
    // ⛔ State vouches for the Caddy it was applied to — not for whatever the transport now reaches.
    const { admin, caddy } = setup(FOREIGN);
    const output = { configSha256: sha, endpoint: 'unix:///run/elsewhere.sock' };
    await expectApply(reconcile(admin, deploy, output), caddy, loaded);
  });
});
