/**
 * Ownership with no state, through the REAL `CaddyConfig.Provider` (not the lifecycle functions
 * config-adopt.test.ts drives directly) — `read`'s `Unowned` branding and `reconcile`'s `--adopt`
 * resolution (`AdoptPolicy`, `AlchemyContext`), the way the engine actually calls them. Split out
 * at the 250-line file cap; config-adopt.test.ts's module doc states the underlying decision.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { AdoptPolicy, Unowned } from 'alchemy/AdoptPolicy';
import { AlchemyContext } from 'alchemy/AlchemyContext';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { type CaddyAdminService, type CaddyTransport, caddyAdminLayer } from './admin.ts';
import { CaddyConfig, CaddyConfigProvider } from './config.ts';
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

const loads = (caddy: FakeCaddy) => caddy.seen.filter((call) => call.path === '/load');

type Deploy = { readonly adopt?: boolean; readonly contextAdopt?: boolean };

/** The provider over `admin`, run under the services a deploy provides (the CLI's `--adopt`). */
const withProvider = <A>(
  admin: CaddyTransport,
  deploy: Deploy,
  // ★ `CaddyAdminService` ONLY — see providers.test.ts's own `withProvider` for why.
  use: (
    p: Effect.Success<typeof CaddyConfig.Provider>,
  ) => Effect.Effect<A, unknown, CaddyAdminService>,
) => {
  // ⚠️ `Layer.provideMerge`, not `Layer.provide` — providers.ts's own doc on `caddyAdminLayer` says
  //   why: `CaddyConfigProvider()`'s handlers still need these services every time they run, not
  //   just once while the provider is built.
  let program = Effect.gen(function* () {
    return yield* use(yield* CaddyConfig.Provider);
  }).pipe(Effect.provide(CaddyConfigProvider().pipe(Layer.provideMerge(caddyAdminLayer(admin)))));
  if (deploy.adopt !== undefined) {
    program = program.pipe(Effect.provideService(AdoptPolicy, deploy.adopt));
  }
  if (deploy.contextAdopt !== undefined) {
    const context = { adopt: deploy.contextAdopt, dev: false, dotAlchemy: '.alchemy' };
    program = program.pipe(Effect.provideService(AlchemyContext, context));
  }
  return Effect.runPromise(program);
};

const read = (admin: CaddyTransport, caddyfile: unknown, output?: object) =>
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

const reconcile = (admin: CaddyTransport, deploy: Deploy, output?: object) =>
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
