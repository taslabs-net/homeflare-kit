/**
 * The leak this fix closes: `caddyProviders()` used to merge Caddy's admin `HttpClient.HttpClient`
 * (and `Credentials`) straight into ITS OWN Layer output (providers.ts's `provideMerge`). Once Caddy
 * sits in a stack's `Layer.mergeAll(…the stack's providers…)` (the exact shape homeflare-mini's
 * `alchemy.run.ts` uses), its leaked client can shadow the stack's own ambient one for every sibling
 * fetch-based provider merged alongside it — homeflare-mini's Forgejo and LiteLLM rows, per the PR
 * evidence. Split from providers.test.ts at the 250-line cap.
 *
 * ⛔ A HAND-BUILT `Effect.provide(Layer.mergeAll(ambient, caddyProviders(admin), someProvider))` CANNOT
 *   REPRODUCE THIS — measured 2026-09-26 (red-team review), correcting an earlier version of this file
 *   that claimed it did. `Layer.mergeAll` does not thread one member's output into another member's
 *   requirement, so making a sibling provider that requires `HttpClient.HttpClient` typecheck inside
 *   the same `mergeAll` as `ambient` needs `someProvider.pipe(Layer.provideMerge(ambient))` — but that
 *   `provideMerge` also re-outputs `ambient` as the LAST layer effect's own build, which then wins any
 *   later flat-context lookup regardless of whether Caddy leaked, defeating the setup whether the bug
 *   is present or not (0 fail either way — confirmed by re-swapping in the pre-fix admin.ts/config.ts/
 *   providers.ts and re-running: still 2 pass, 0 fail, with or without `--rerun-each 3`).
 * ★ THE REAL SHAPE INSTEAD: `verify/fake-engine.ts`'s `engineOver` runs the ACTUAL `Alchemy.Stack` +
 *   `Plan.make` + `apply` over an in-memory state store — the same merge Stack.ts itself performs
 *   (providers' combined context over the platform's ambient `FetchHttpClient`), not a hand-assembled
 *   stand-in for it. `Layer.mergeAll(caddyProviders(admin), ProbeProvider()).pipe(Layer.provideMerge
 *   (ambient))` mirrors a real stack's `providers` option with `ambient` standing in for the platform
 *   layer Stack.ts itself provides underneath — CAPTURED FAILURE on pre-fix admin.ts/config.ts/
 *   providers.ts (bun test, this file):
 *     (fail) ENGINE: Alchemy.Stack + Plan + apply, ambient under the merged providers
 *       error: expect(received).toEqual(expected)
 *         Expected: Set {"ambient"}
 *         Received: Set {"{\"error\":\"host not allowed: 127.0.0.1:<port>\"}\n"}
 *   (the sibling's `client.get('http://sibling.invalid/probe')` dialled Caddy's OWN admin transport —
 *   a real loopback connect to the fake Caddy server, which answered its Host check (admin-guard.ts's
 *   own concern, at the wire) rather than ever reaching `sibling.invalid`); passes post-fix.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import { engineOver } from '../verify/fake-engine.ts';
import { CaddyConfig } from './config.ts';
import { type FakeCaddy, fakeDefaultCaddy } from './fake-caddy.ts';
import { caddyProviders } from './providers.ts';

const SITE = 'app.example.com reverse_proxy 127.0.0.1:8080';
const ids = { fqn: 'stack/caddy', id: 'caddy', instanceId: 'i-1' };

/** Stands in for a real fetch-based sibling (Forgejo, LiteLLM): a `Provider` whose handlers do
 * exactly what a distilled SDK's generated operation does — `yield* HttpClient.HttpClient`. */
interface Probe extends Resource<'Test.Probe', { name: string }, { via: string }> {}
const Probe = Resource<Probe>('Test.Probe');

const ProbeProvider = (vias: string[]) => {
  const hit = Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get('http://sibling.invalid/probe');
    const via = yield* response.text;
    vias.push(via);
    return { via };
  });
  return Provider.succeed(Probe, {
    read: () => Effect.as(hit, undefined),
    reconcile: () => hit,
    delete: () => Effect.void,
  });
};

/** Answers instantly and records that IT (not some other client) was the one asked. */
const labeledClient = (label: string, seen: string[]): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      seen.push(label);
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(label)));
    }),
  );

let fake: FakeCaddy | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});

describe('caddyProviders() admin-transport scoping', () => {
  test('a sibling provider merged alongside it gets the AMBIENT client, never the admin one', async () => {
    // ★ The real engine (Alchemy.Stack + Plan + apply, see the file header's ★): `ambient` stands in
    //   for the platform's own `FetchHttpClient`, `Layer.provideMerge`d under the stack's merged
    //   providers exactly as Stack.ts does. This never starts the fake Caddy's own traffic — it only
    //   proves WHICH client the sibling resolves, so the admin transport can point anywhere;
    //   `fakeDefaultCaddy()` gives it a real one.
    const { admin, caddy } = fakeDefaultCaddy();
    fake = caddy;
    const vias: string[] = [];
    const ambient = labeledClient('ambient', vias);
    const engine = engineOver(
      Layer.mergeAll(caddyProviders(admin), ProbeProvider(vias)).pipe(Layer.provideMerge(ambient)),
    );
    await engine.deploy(Probe('p', { name: 'sibling' }));
    expect(vias.length).toBeGreaterThan(0);
    // ★ Every hit the sibling made must read the ambient client's own label, never an error body from
    //   Caddy's admin transport (admin-guard.ts's Host check, reached only by a wrong client).
    expect(new Set(vias)).toEqual(new Set(['ambient']));
  });

  test("Caddy's own admin calls still go through ITS transport, never the stack's ambient client", async () => {
    const { admin, caddy } = fakeDefaultCaddy();
    fake = caddy;
    const seen: string[] = [];
    const stack = Layer.mergeAll(labeledClient('ambient', seen), caddyProviders(admin));
    await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* CaddyConfig.Provider;
        return yield* provider.reconcile({
          ...ids,
          bindings: [] as never,
          news: { caddyfile: SITE },
          olds: { caddyfile: SITE },
          output: { configSha256: 'earlier', endpoint: caddy.address },
          session: undefined as never,
        });
      }).pipe(Effect.provide(stack)),
    );
    expect(caddy.seen.some((call) => call.path === '/load')).toBe(true);
    // ★ The ambient stub is never asked anything: every admin call reached `admin`'s own transport.
    expect(seen).toEqual([]);
  });
});
