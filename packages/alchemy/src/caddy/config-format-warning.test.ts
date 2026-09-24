/**
 * The "Caddyfile is not formatted" warning gets its OWN clear line, at both PLAN time
 * (config-reconcile.ts's diffConfig) and DEPLOY time (config.ts's CaddyConfigProvider reconcile)
 * — format-warnings.ts's split, wired into both. Captured with a Logger, the house pattern for
 * asserting on `Effect.logWarning` (proxmox/lxc-harness.ts's `collect`).
 *
 * format-warnings.test.ts already covers the split itself in isolation; this file is the proof
 * that plan and deploy actually call it, so a Caddyfile nobody ran through `caddy fmt` gets the
 * fix line — not silence, and not just the adapter's own warning buried among others.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { AdoptPolicy } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Logger from 'effect/Logger';
import { caddyAdminLayer } from './admin.ts';
import { CaddyConfig, CaddyConfigProvider } from './config.ts';
import { diffConfig } from './config-reconcile.ts';
import { type FakeCaddy, fakeDefaultCaddy } from './fake-caddy.ts';

const SITE = 'app.example.com reverse_proxy 127.0.0.1:8080';
const UNFORMATTED = `${SITE}\t`; // fake-caddy.ts: a TAB anywhere is its "not formatted" trigger
const ids = { fqn: 'stack/caddy', id: 'caddy', instanceId: 'i-1' };

let fake: FakeCaddy | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});

const setup = () => {
  const made = fakeDefaultCaddy();
  fake = made.caddy;
  return made;
};

/** Runs `effect` and returns its result plus every `Effect.logWarning` line it emitted. */
const withWarnings = async <A>(effect: Effect.Effect<A, unknown, never>) => {
  const warnings: string[] = [];
  const collect = Logger.make((options) => {
    if (options.logLevel === 'Warn') warnings.push(String(options.message));
  });
  const value = await Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([collect]))));
  return { value, warnings };
};

describe('the formatting warning is surfaced distinctly', () => {
  test('plan: diffConfig logs the fix line for an unformatted Caddyfile', async () => {
    const { admin } = setup();
    const output = { configSha256: 'stub', endpoint: admin.endpoint };
    const { value, warnings } = await withWarnings(
      diffConfig({ caddyfile: UNFORMATTED }, output).pipe(Effect.provide(caddyAdminLayer(admin))),
    );
    expect(value).toEqual({ action: 'update' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('caddy fmt');
    expect(warnings[0]).toContain(admin.endpoint);
  });

  test('plan: a formatted Caddyfile logs nothing', async () => {
    const { admin } = setup();
    const output = { configSha256: 'stub', endpoint: admin.endpoint };
    const { warnings } = await withWarnings(
      diffConfig({ caddyfile: SITE }, output).pipe(Effect.provide(caddyAdminLayer(admin))),
    );
    expect(warnings).toEqual([]);
  });

  test('deploy: the real CaddyConfigProvider logs the fix line, not the raw adapter text', async () => {
    const { admin } = setup();
    const program = Effect.gen(function* () {
      const provider = yield* CaddyConfig.Provider;
      return yield* provider.reconcile({
        ...ids,
        bindings: [] as never,
        news: { caddyfile: UNFORMATTED },
        olds: undefined,
        output: undefined as never,
        session: undefined as never,
      });
    }).pipe(
      Effect.provide(CaddyConfigProvider().pipe(Layer.provideMerge(caddyAdminLayer(admin)))),
      // reconcile with no state needs an adopt decision; a fresh Caddy has nothing to adopt.
      Effect.provideService(AdoptPolicy, true),
    );
    const { warnings } = await withWarnings(program as Effect.Effect<unknown, unknown, never>);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('caddy fmt');
    expect(warnings.some((w) => w.includes('Caddyfile input is not formatted'))).toBe(false);
  });
});
