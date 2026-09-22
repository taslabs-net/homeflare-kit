/**
 * A resource-scoped `adopt(…)` at apply — the create Alchemy never probed (caddyWithFile's first
 * deploy). The planner resolves adoption as `resource.Adopt ?? --adopt` (alchemy beta.79 Plan.ts);
 * the apply-time check must resolve it the same way, BOTH ways, or `--adopt` would take over a
 * Caddy the stack declared `.pipe(adopt(false))`.
 * ★ Registered through the REAL `Resource` (caddyWithFile under a Stack), not a hand-built map: the
 *   lookup reads what Alchemy records at registration, so an upgrade that stops recording `Adopt`
 *   in `Stack.resources` fails here (ownership/adopt.ts adoptEnabled).
 */
import { afterEach, expect, test } from 'bun:test';
import { push } from 'alchemy';
import { AdoptPolicy, adopt } from 'alchemy/AdoptPolicy';
import { Stack } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { caddyAdminLayer } from './admin.ts';
import { CaddyConfig, CaddyConfigProvider } from './config.ts';
import { type FakeCaddy, fakeDefaultCaddy } from './fake-caddy.ts';
import { caddyWithFile } from './with-file.ts';

const SITE = 'app.example.com reverse_proxy 127.0.0.1:8080';
/** A config someone else loaded: it serves a site, and it is not what the stack declares. */
const FOREIGN = { apps: { http: { servers: { legacy: { listen: [':80'] } } } } };

let fake: FakeCaddy | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});

type Scope = 'adopt(true)' | 'adopt(false)' | 'none';

/**
 * Declare caddyWithFile with `scope` under a deploy whose `--adopt` is `flag` — the session provides
 * AdoptPolicy to registration AND apply, as Alchemist does — then apply the CaddyConfig with no state.
 */
const applyFirstDeploy = (scope: Scope, flag: boolean) => {
  const made = fakeDefaultCaddy(FOREIGN);
  fake = made.caddy;
  const spec = { actions: {}, bindings: {}, name: 'test', resources: {}, stage: 'test' };
  const declared = caddyWithFile('caddy', { caddyfile: SITE, path: '/usr/local/etc/Caddyfile' });
  const scoped =
    scope === 'none'
      ? declared
      : (declared.pipe(adopt(scope === 'adopt(true)')) as typeof declared);
  const program = Effect.gen(function* () {
    // ★ Under a namespace, so the FQN (`edge/caddy`) differs from the logical id (`caddy`).
    yield* push('edge', scoped);
    const provider = yield* CaddyConfig.Provider;
    return yield* provider.reconcile({
      bindings: [] as never,
      fqn: 'edge/caddy',
      id: 'caddy',
      instanceId: 'i-1',
      news: { caddyfile: SITE, sourceFile: '/usr/local/etc/Caddyfile' },
      olds: undefined,
      output: undefined,
      session: undefined as never,
    });
  }).pipe(
    Effect.provide(CaddyConfigProvider().pipe(Layer.provide(caddyAdminLayer(made.admin)))),
    Effect.provideService(AdoptPolicy, flag),
    Effect.provideService(Stack, spec as never),
  );
  return { applying: Effect.runPromise(program as Effect.Effect<unknown, unknown>), spec };
};

const loads = () => fake?.seen.filter((call) => call.path === '/load') ?? [];

test.each([
  ['adopt(false) under --adopt', 'adopt(false)', true, false],
  ['adopt(true) without --adopt', 'adopt(true)', false, true],
  ['no scope under --adopt', 'none', true, true],
  ['no scope without --adopt', 'none', false, false],
] as const)('a first deploy with %s', async (_, scope, flag, loaded) => {
  const { applying, spec } = applyFirstDeploy(scope, flag);
  if (loaded) await applying;
  else await expect(applying).rejects.toThrow(/which this stack did not load.*--adopt/);
  // ★ The lookup key is the FQN the engine hands reconcile — the one registration used.
  expect(Object.keys(spec.resources)).toContain('edge/caddy');
  expect(loads()).toHaveLength(loaded ? 1 : 0);
});
