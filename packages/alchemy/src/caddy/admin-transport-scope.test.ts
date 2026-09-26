/**
 * The leak this fix closes: `caddyProviders()` used to merge Caddy's admin `HttpClient.HttpClient`
 * (and `Credentials`) straight into ITS OWN Layer output (providers.ts's `provideMerge`). A `read`/
 * `reconcile` closure (a `Provider.succeed`/`.effect` service's method — Forgejo's, LiteLLM's,
 * `ProbeProvider()` below) is called LATER, as plain program code, never as another layer's own
 * build-time dependency, so it resolves `HttpClient.HttpClient` from the FLAT merged context
 * `Effect.provide` built for the whole stack — `Layer.mergeAll(…the stack's providers…)`, the exact
 * shape the evidence's homeflare-mini `alchemy.run.ts` uses. Whichever member of that merge outputs
 * a given service LAST wins for every later plain lookup of it; once Caddy is in the list, ITS
 * leaked client can shadow the stack's own ambient one for every sibling fetch-based provider merged
 * alongside it — homeflare-mini's Forgejo and LiteLLM rows, per the PR evidence. Split from
 * providers.test.ts at the 250-line cap.
 *
 * ⛔ THE FIRST TEST FAILS ON origin/main (267a8a0) — captured failure (bun test, this file, before
 *   the fix; `admin` here is a `fakeDefaultCaddy()` transport the sibling never means to call):
 *     (fail) caddyProviders() admin-transport scoping > a sibling provider merged alongside it
 *       gets the AMBIENT client, never the admin one
 *     error: expect(received).toEqual(expected)
 *       Expected: {"via": "ambient"}
 *       Received: {"via": "{\"error\":\"host not allowed: 127.0.0.1:<port>\"}\n"}
 *     (the sibling's `client.get('http://sibling.invalid/probe')` dialled Caddy's OWN admin
 *      transport instead — a real loopback connect to the fake Caddy server, which answered its
 *      Host check (admin-guard.ts's own concern, at the wire) rather than ever reaching
 *      `sibling.invalid`; `seen` stayed `[]`, proving the ambient stub was never asked at all)
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import { CaddyConfig } from './config.ts';
import { type FakeCaddy, fakeDefaultCaddy } from './fake-caddy.ts';
import { caddyProviders } from './providers.ts';

const SITE = 'app.example.com reverse_proxy 127.0.0.1:8080';
const ids = { fqn: 'stack/caddy', id: 'caddy', instanceId: 'i-1' };

/** Stands in for a real fetch-based sibling (Forgejo, LiteLLM): a `Provider` whose handler does
 * exactly what a distilled SDK's generated operation does — `yield* HttpClient.HttpClient`. */
interface Probe extends Resource<'Test.Probe', {}, { via: string }> {}
const Probe = Resource<Probe>('Test.Probe');

const ProbeProvider = () =>
  Provider.succeed(Probe, {
    reconcile: () =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const response = yield* client.get('http://sibling.invalid/probe');
        return { via: yield* response.text };
      }),
    delete: () => Effect.void,
  });

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
    // ★ This test never starts the fake Caddy's own traffic — it only proves WHICH client a sibling
    //   resolves, so the admin transport can point anywhere; `fakeDefaultCaddy()` gives it a real one.
    const { admin, caddy } = fakeDefaultCaddy();
    fake = caddy;
    const seen: string[] = [];
    const ambient = labeledClient('ambient', seen);
    // ★ ONE FLAT MERGE — the stack's own base service plus its providers (Caddy and the sibling),
    //   exactly `Layer.mergeAll(GitHub.providers(), …, caddyProviders(), litellmProviders(), …,
    //   forgejoProviders())` from the evidence. `ProbeProvider().pipe(Layer.provideMerge(ambient))`
    //   is what makes this typecheck at all — `Layer.mergeAll` alone never threads one member's
    //   output into another's requirement (repository-ruleset-providers.ts's own measured doc on
    //   this exact limitation) — and it does NOT change what a LATER `provider.reconcile()` call
    //   resolves: `ambient` is the SAME layer object referenced twice (Effect's layer memoization
    //   builds it once), and a `Provider.succeed` closure is called LATER as plain program code, not
    //   as another layer's build-time dependency, so it still reads from `stack`'s own FLAT merged
    //   context — where, pre-fix, Caddy's OWN leaked `HttpClient.HttpClient` (listed after `ambient`)
    //   wins that later lookup; post-fix Caddy contributes none, so `ambient` is what is left.
    const stack = Layer.mergeAll(
      ambient,
      caddyProviders(admin),
      ProbeProvider().pipe(Layer.provideMerge(ambient)),
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* Probe.Provider;
        return yield* provider.reconcile({
          ...ids,
          bindings: [] as never,
          news: {},
          olds: undefined,
          output: undefined,
          session: undefined as never,
        });
      }).pipe(Effect.provide(stack)),
    );
    expect(result).toEqual({ via: 'ambient' });
    expect(seen).toEqual(['ambient']);
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
