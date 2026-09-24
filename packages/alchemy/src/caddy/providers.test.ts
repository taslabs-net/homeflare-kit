/**
 * The Alchemy wiring: the provider built as a Layer over a fake admin API, its handlers called the
 * way the engine calls them; caddyWithFile's registration; and the barrel, the public API.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import * as Output from 'alchemy/Output';
import { Stack } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type * as Caddy from '@distilled.cloud/caddy';
import { type CaddyAdminService, caddyAdminLayer } from './admin.ts';
import { CaddyConfig, CaddyConfigProvider } from './config.ts';
import { type FakeCaddy, fakeCaddy } from './fake-caddy.ts';
import * as barrel from './index.ts';
import { localCaddyAdmin } from './local-admin.ts';
import { caddyWithFile } from './with-file.ts';

const SITE = 'app.example.com reverse_proxy 127.0.0.1:8080';
const ids = { fqn: 'stack/caddy', id: 'caddy', instanceId: 'i-1' };

let fake: FakeCaddy | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});

/** A handler the provider must define; a missing one fails the test by name. */
const handler = <F>(name: string, fn: F | undefined): F => {
  if (fn === undefined) throw new Error(`provider has no ${name} handler`);
  return fn;
};

const withProvider = <A>(
  use: (
    p: Effect.Success<typeof CaddyConfig.Provider>,
  ) => Effect.Effect<A, unknown, CaddyAdminService | Caddy.CaddyOpContext>,
  address?: string,
) => {
  // ★ A Caddy on its default :2019 behind a forward, as in config-lifecycle.test.ts.
  fake =
    address === undefined
      ? fakeCaddy({ listenPort: 2019, running: { apps: { legacy: true } } })
      : undefined;
  const admin = localCaddyAdmin({
    address: address ?? (fake as FakeCaddy).address,
    hostHeader: '127.0.0.1:2019',
    retries: 0,
  });
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* use(yield* CaddyConfig.Provider);
    }).pipe(Effect.provide(CaddyConfigProvider().pipe(Layer.provideMerge(caddyAdminLayer(admin))))),
  );
};

describe('CaddyConfigProvider', () => {
  test('reconcile applies over its own state; delete then sends nothing at all', async () => {
    await withProvider((provider) =>
      Effect.gen(function* () {
        const output = yield* provider.reconcile({
          ...ids,
          bindings: [] as never,
          news: { caddyfile: SITE },
          olds: { caddyfile: SITE },
          // ★ State from an earlier deploy: the running `legacy` config is this stack's to replace.
          output: { configSha256: 'earlier', endpoint: fake?.address ?? '' },
          session: undefined as never,
        });
        expect(fake?.seen.some((call) => call.path === '/load')).toBe(true);
        const before = fake?.seen.length;
        yield* provider.delete({ ...ids, olds: { caddyfile: SITE }, output } as never);
        // ★ Delete never unloads, never stops: not one more call reached Caddy.
        expect(fake?.seen.length).toBe(before);
      }),
    );
  });

  test('diff defers to the engine with no prior output', async () => {
    const diff = await withProvider((provider) =>
      handler(
        'diff',
        provider.diff,
      )({
        ...ids,
        news: { caddyfile: SITE },
        olds: { caddyfile: SITE },
        output: undefined,
      } as never),
    );
    expect(diff).toBeUndefined();
  });

  test('an unresolved sourceFile still validates the Caddyfile at plan time', async () => {
    const pending = Effect.succeed('/usr/local/etc/Caddyfile');
    const output = { configSha256: 'x', endpoint: 'y' };
    const ok = await withProvider((provider) =>
      handler(
        'diff',
        provider.diff,
      )({
        ...ids,
        news: { caddyfile: SITE, sourceFile: pending },
        olds: { caddyfile: SITE },
        output,
      } as never),
    );
    expect(ok).toEqual({ action: 'update' });
    const bad = withProvider((provider) =>
      handler(
        'diff',
        provider.diff,
      )({
        ...ids,
        news: { caddyfile: 'SYNTAX_ERROR', sourceFile: pending },
        olds: { caddyfile: SITE },
        output,
      } as never),
    );
    await expect(bad).rejects.toThrow(/Error during parsing/);
  });
});

describe('a Caddy that is down', () => {
  /** A loopback port that just closed: connecting is refused, nothing is listening. */
  const closedPort = () => {
    const server = Bun.serve({ fetch: () => new Response(), hostname: '127.0.0.1', port: 0 });
    const address = `http://127.0.0.1:${String(server.port)}`;
    server.stop(true);
    return address;
  };
  const output = { configSha256: 'x', endpoint: 'y' };

  test('does not fail the plan: read finds nothing to adopt, diff plans an update', async () => {
    const address = closedPort();
    const probe = await withProvider(
      (provider) =>
        handler('read', provider.read)({ ...ids, olds: { caddyfile: SITE }, output: undefined }),
      address,
    );
    expect(probe).toBeUndefined();
    const diff = await withProvider(
      (provider) =>
        handler(
          'diff',
          provider.diff,
        )({ ...ids, news: { caddyfile: SITE }, olds: { caddyfile: SITE }, output } as never),
      address,
    );
    expect(diff).toEqual({ action: 'update' });
  });

  test('but the apply, which needs Caddy, fails loudly', async () => {
    const applying = withProvider(
      (provider) =>
        provider.reconcile({
          ...ids,
          bindings: [] as never,
          news: { caddyfile: SITE },
          olds: undefined,
          output: undefined,
          session: undefined as never,
        }),
      closedPort(),
    );
    // ★ Reconcile never catches `isUnreachable` (config.ts): the raw, still-typed
    //   `HttpClientError` propagates as-is, its own `.message` naming the operation and URL.
    await expect(applying).rejects.toThrow(
      /Transport error \(POST http:\/\/127\.0\.0\.1.*\/adapt\)/,
    );
  });

  test('a bad Caddyfile still fails the plan when Caddy IS up (only unreachability is forgiven)', async () => {
    const bad = withProvider((provider) =>
      handler(
        'diff',
        provider.diff,
      )({
        ...ids,
        news: { caddyfile: 'SYNTAX_ERROR' },
        olds: { caddyfile: SITE },
        output,
      } as never),
    );
    await expect(bad).rejects.toThrow(/Error during parsing/);
  });
});

describe('caddyWithFile', () => {
  const stack = () => ({ actions: {}, bindings: {}, name: 'test', resources: {}, stage: 'test' });

  test('declares the HostFile (retained) and a CaddyConfig ordered after it', async () => {
    const spec = stack();
    const { config, file } = await Effect.runPromise(
      caddyWithFile('caddy', { caddyfile: SITE, path: '/usr/local/etc/Caddyfile' }).pipe(
        Effect.provideService(Stack, spec as never),
      ) as Effect.Effect<{ config: unknown; file: unknown }>,
    );
    expect(Object.keys(spec.resources).sort()).toEqual(['caddy', 'caddy-file']);
    const target = config as { Props: { sourceFile: unknown }; RemovalPolicy: string };
    // ★ An Output of the HostFile, not the literal path: that edge is what writes the file first.
    expect(Output.isExpr(target.Props.sourceFile)).toBe(true);
    expect(target.RemovalPolicy).toBe('retain');
    expect((file as { RemovalPolicy: string }).RemovalPolicy).toBe('retain');
  });

  test('a literal secret is refused before the HostFile — and its content prop — exist', async () => {
    const spec = stack();
    const failure = Effect.runPromise(
      Effect.flip(
        caddyWithFile('caddy', {
          caddyfile: 'dns cloudflare abcdef0123456789',
          path: '/etc/Caddyfile',
        }),
      ).pipe(Effect.provideService(Stack, spec as never)) as Effect.Effect<Error>,
    );
    expect((await failure).message).toMatch(/caddyWithFile caddy: line 1/);
    expect(spec.resources).toEqual({});
  });
});

describe('the barrel', () => {
  test('exports the public API and not the internals', () => {
    expect(Object.keys(barrel).sort()).toEqual([
      'CaddyAdminService',
      'CaddyConfig',
      'CaddyConfigProvider',
      'DEFAULT_ADMIN_ADDRESS',
      // Caddyfile TEXT for an Access-protected route, not a resource — see
      // access-forward-auth.ts. It pairs with @homeflare/cloudflare/access-auth.
      'accessForwardAuth',
      'caddyAdminLayer',
      'caddyProviders',
      'caddyWithFile',
      // The type guard config.ts's plan-time escape hatch narrows unreachable failures with —
      // exported so a consumer's own transport (an SSH forward, a remote runner) can reuse it.
      'isUnreachable',
      'localCaddyAdmin',
      'verifierProblems',
    ]);
  });
});
