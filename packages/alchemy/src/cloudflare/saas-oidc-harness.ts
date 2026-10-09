/**
 * SaasOidcApplicationProvider's handlers, called the way the engine calls them, over the fake
 * Access API in fake-access.ts — and `engine`, which runs Alchemy's real plan/apply over the same
 * fake and exposes the in-memory state rows. Shared by saas-oidc.test.ts and
 * saas-oidc-state.test.ts. ⛔ TEST-ONLY, like fake-access.ts.
 */
import { apply } from 'alchemy/Apply';
import * as Plan from 'alchemy/Plan';
import { type CompiledStack, make as makeStack } from 'alchemy/Stack';
import { Stage } from 'alchemy/Stage';
import * as State from 'alchemy/State';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import { type FakeAccess, TEAM } from './fake-access.ts';
import { fakeProviderLayer } from './fake-mesh.ts';
import type { SaasOidcApplicationAttributes, SaasOidcApplicationProps } from './saas-oidc-form.ts';
import { SaasOidcApplication, SaasOidcApplicationProvider } from './saas-oidc.ts';

export const ids = { fqn: 'stack/headlamp', id: 'headlamp', instanceId: 'i-1' };
export const extra = { bindings: [] as never, session: undefined as never };

export type P = Effect.Success<typeof SaasOidcApplication.Provider>;

/** A public PKCE client, the shape Headlamp declares (Q6). */
export const publicClient = (
  over: Partial<SaasOidcApplicationProps> = {},
): SaasOidcApplicationProps => ({
  name: 'Headlamp',
  teamDomain: TEAM,
  policies: ['policy-admin'],
  saasApp: {
    authType: 'oidc',
    redirectUris: ['https://headlamp.example.test/oidc-callback'],
    scopes: ['openid', 'email', 'groups'],
    grantTypes: ['authorization_code_with_pkce'],
    accessTokenLifetime: '15m',
    allowPkceWithoutClientSecret: true,
  },
  ...over,
});

/** The wire `saas_app` of a live app that matches `publicClient()` exactly (no drift to sync). */
export const LIVE_OIDC = {
  auth_type: 'oidc',
  redirect_uris: ['https://headlamp.example.test/oidc-callback'],
  scopes: ['openid', 'email', 'groups'],
  grant_types: ['authorization_code_with_pkce'],
  access_token_lifetime: '15m',
  allow_pkce_without_client_secret: true,
};

/** Build the provider over the fake and hand it to `use`. */
export const run = <A, E>(fake: FakeAccess, use: (p: P) => Effect.Effect<A, E, never>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* use(yield* SaasOidcApplication.Provider);
    }).pipe(
      Effect.provide(
        SaasOidcApplicationProvider().pipe(Layer.provideMerge(fakeProviderLayer(fake))),
      ),
      // `createPhysicalName` reads these from the engine's context; a named app never calls it.
      Effect.provideService(FetchHttpClient.Fetch, fake.fetch),
    ) as Effect.Effect<A, E, never>,
  );

export const reconcile = (
  p: P,
  news: SaasOidcApplicationProps,
  output?: SaasOidcApplicationAttributes,
) => p.reconcile({ ...ids, ...extra, news, olds: undefined, output });

export const read = (
  p: P,
  olds: SaasOidcApplicationProps,
  output?: SaasOidcApplicationAttributes,
) => {
  const handler = p.read;
  if (handler === undefined) throw new Error('provider has no read handler');
  return handler({ ...ids, olds, output });
};

/** The writes the fake saw, in order: `['POST', 'PUT', …]`. */
export const writes = (fake: FakeAccess) =>
  fake.seen.filter((s) => s.method !== 'GET').map((s) => s.method);

type Rows = Record<string, Record<string, Record<string, State.ResourceState>>>;

/**
 * ★ THE REAL ENGINE, NOT A MODEL OF IT: `Plan.make` + `apply` over an in-memory state store, as
 *   mesh-node-harness.ts does. `rows` is that store, so a test can serialise exactly what Alchemy
 *   would persist.
 */
export const engine = (fake: FakeAccess, extra: Layer.Layer<never, never, never> = Layer.empty) => {
  const rows: Rows = {};
  const state = Layer.succeed(State.State, State.InMemoryService(rows));
  const providers = Layer.mergeAll(
    SaasOidcApplicationProvider().pipe(Layer.provide(fakeProviderLayer(fake))),
    extra,
  );
  const deploy = <A, E, R>(declare: Effect.Effect<A, E, R>) =>
    Effect.runPromiseExit(
      declare.pipe(
        makeStack({ name: 'oidc', providers, state }) as never,
        Effect.flatMap((compiled: CompiledStack) =>
          Plan.make(compiled).pipe(Effect.flatMap(apply), Effect.provide(compiled.services)),
        ),
        Effect.provide(Layer.succeed(Stage, 'test')),
        Effect.scoped,
        Effect.provideService(FetchHttpClient.Fetch, fake.fetch),
      ) as Effect.Effect<unknown, unknown>,
    );
  return {
    deploy,
    rows,
    status: (fqn: string) => rows['oidc']?.['test']?.[fqn]?.status,
  };
};

/** The failure sentence of a deploy, or `''` when it succeeded. */
export const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : '';
