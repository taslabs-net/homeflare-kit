/**
 * `GetOnlyHttpClient` (`resource.ts`, B0a/T12) in isolation — against a bare `HttpClient` service,
 * no `CredentialsFromEnv`, no real SDK operation. Proves the guard's own mechanism: a `GET`
 * reaches the wrapped transport unchanged, and any other method dies with `UnifiNonGetRequest`
 * BEFORE the fake server ever sees it (`fake.seen` stays empty for the refused call).
 *
 * ⚠️ NOT ROUTED THROUGH `unifiHandlers`/`CredentialsFromEnv` ON PURPOSE — see `fake-unifi.ts`'s
 *   own warning: `CredentialsFromEnv` resolves `UNIFI_NETWORK_*` through Effect's `Config`, which
 *   this directory's existing tests all avoid depending on for the same reason. Since the guard
 *   only touches the `HttpClient` service, testing it directly here is both simpler and a more
 *   precise proof of the mechanism than routing real credentials through it would be.
 * ⚠️ CORRECTION (2026-09-26, red team): the line this replaces claimed `network.test.ts`/
 *   `firewall-zone.test.ts` prove `withCredentials` lets a real GET through. They don't —
 *   both call `unifiOperations(spec)` directly, which bypasses `unifiHandlers`/`withCredentials`
 *   (and therefore this guard) entirely. Proof: deleting `Effect.provide(GetOnlyHttpClient)` from
 *   `withCredentials` (`resource.ts`) left all 56 tests green before this file's own
 *   `describe('GetOnlyHttpClient installed in unifiHandlers', …)` block below existed. THAT block
 *   is what closes the gap: it drives `unifiHandlers(...).read`/`.reconcile` — the actual exported
 *   entry points a real deploy calls — through a `ConfigProvider` override (the same pattern
 *   `opnsense/write-refusal.test.ts` uses for `CredentialsFromEnv`), so it fails if the guard is
 *   ever removed from `withCredentials` again.
 * ★ REUSES `fakeUnifi` (`fake-unifi.ts`), NOT AN AD HOC MOCK. `fakeUnifi`'s wrapper records
 *   `seen` BEFORE calling `route`, so even a `route` that would throw still proves whether the
 *   guard let a request through — the assertion is on `seen`, never on catching that throw.
 */
import { describe, expect, test } from 'bun:test';
import * as Cause from 'effect/Cause';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/http/HttpClient';
import type * as HttpClientError from 'effect/http/HttpClientError';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import { FAKE_BASE, FAKE_KEY, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import {
  GetOnlyHttpClient,
  UnifiNonGetRequest,
  type UnifiSpec,
  unifiHandlers,
} from './resource.ts';

const FAKE_PATH = '/proxy/network/integration/v1/sites/site-1/networks';
const FAKE_URL = `https://unifi.example.com${FAKE_PATH}`;

/** One request through `GetOnlyHttpClient`, over a fake transport built by `fakeUnifi`. */
const sendGuarded = (method: string, fetchFn: typeof globalThis.fetch) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      return yield* client.execute(HttpClientRequest.make(method as never)(FAKE_URL));
    }).pipe(Effect.provide(GetOnlyHttpClient), Effect.provide(fakeUnifiLayer(fetchFn))),
  );

describe('GetOnlyHttpClient', () => {
  test('a GET request passes through unchanged and reaches the transport', async () => {
    const fake = fakeUnifi(() => Response.json({ ok: true }));

    const exit = await sendGuarded('GET', fake.fetch);

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(fake.seen).toEqual([{ method: 'GET', path: FAKE_PATH }]);
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s dies with UnifiNonGetRequest and never reaches the transport',
    async (method) => {
      const fake = fakeUnifi(() => {
        throw new Error(`get-only-guard.test.ts: unexpected ${method} reached the fake transport`);
      });

      const exit = await sendGuarded(method, fake.fetch);

      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) return;
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      const defect = Cause.squash(exit.cause);
      expect(defect).toBeInstanceOf(UnifiNonGetRequest);
      expect((defect as UnifiNonGetRequest).method).toBe(method);
      // ⛔ THE PROOF: the fake transport never even recorded the call -- the guard refused the
      //   request in `mapRequestEffect`, before dispatch, not after a failed response.
      expect(fake.seen).toEqual([]);
    },
  );
});

interface ProbeProps {
  id: string;
}

/**
 * A `fetchLive` that sends exactly one raw request over whatever `method` the test wants to
 * probe — not a real SDK operation, on purpose: this block proves the GUARD'S INSTALLATION in
 * `unifiHandlers`, not any one family's own all-GET behavior (`network.test.ts`/
 * `firewall-zone.test.ts` already prove that, for calls that bypass `unifiHandlers` entirely).
 */
const probeSpec = (
  method: string,
): UnifiSpec<ProbeProps, ProbeProps, ProbeProps, HttpClientError.HttpClientError> => ({
  type: 'Test.Probe',
  describe: (props) => `probe/${props.id}`,
  fetchLive: (props) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      yield* client.execute(HttpClientRequest.make(method as never)(`${FAKE_BASE}/probe`));
      return props;
    }),
  attributes: (live) => live,
  matches: () => true,
});

/**
 * Overrides the `ConfigProvider` `CredentialsFromEnv` resolves `UNIFI_NETWORK_*` against — the
 * SAME pattern `opnsense/write-refusal.test.ts` uses for its own `CredentialsFromEnv` — WITHOUT
 * touching real `process.env` (a parallel test file could race on that). `unifiHandlers`'s
 * `withCredentials` bakes in `CredentialsFromEnv` itself, so providing a `Credentials` layer from
 * OUTSIDE (the way `fake-unifi.ts`'s own `fakeUnifiLayer` does for tests that call `spec.fetchLive`
 * directly) would be shadowed and do nothing here — this ConfigProvider override is what actually
 * reaches it.
 */
const fakeCredentialsConfigProvider = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    UNIFI_NETWORK_API_BASE_URL: FAKE_BASE,
    UNIFI_NETWORK_API_KEY: FAKE_KEY,
  }),
);

describe('GetOnlyHttpClient is installed in unifiHandlers (IMPORTANT-1, red team 2026-09-26)', () => {
  test('a GET through the real handler entry point still reaches the transport', async () => {
    const fake = fakeUnifi(() => Response.json({ id: 'w1' }));
    const attrs = await Effect.runPromise(
      unifiHandlers(probeSpec('GET'))
        .read({ olds: { id: 'w1' }, output: undefined })
        .pipe(
          Effect.provide(Layer.mergeAll(fakeUnifiLayer(fake.fetch), fakeCredentialsConfigProvider)),
        ),
    );
    expect(attrs).toEqual({ id: 'w1' });
    expect(fake.seen).toEqual([{ method: 'GET', path: '/proxy/network/integration/probe' }]);
  });

  test('a non-GET through the real handler entry point dies, never reaching the transport', async () => {
    const fake = fakeUnifi(() => {
      throw new Error('get-only-guard.test.ts: unexpected POST reached the fake transport');
    });
    const exit = await Effect.runPromiseExit(
      unifiHandlers(probeSpec('POST'))
        .read({ olds: { id: 'w1' }, output: undefined })
        .pipe(
          Effect.provide(Layer.mergeAll(fakeUnifiLayer(fake.fetch), fakeCredentialsConfigProvider)),
        ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect(Cause.hasDies(exit.cause)).toBe(true);
    expect(Cause.squash(exit.cause)).toBeInstanceOf(UnifiNonGetRequest);
    // ⛔ THIS IS THE PROOF THE FILE HEADER PROMISES. Verified by hand (2026-09-26): deleting
    //   `Effect.provide(GetOnlyHttpClient)` from `withCredentials` (`resource.ts`) turns this
    //   exact test into a passing `Response.json` round-trip with a non-empty `fake.seen` --
    //   i.e. it FAILS the instant the guard installation regresses, which no test in this
    //   directory could do before this block existed (IMPORTANT-1).
    expect(fake.seen).toEqual([]);
  });
});
