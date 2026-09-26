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
 * ★ `network.test.ts`/`firewall-zone.test.ts`'s own "write paths never reach the vendor API"
 *   blocks additionally prove `withCredentials` (which installs this guard) still lets every real,
 *   all-`GET` read through unchanged — this file does not repeat that.
 * ★ REUSES `fakeUnifi` (`fake-unifi.ts`), NOT AN AD HOC MOCK. `fakeUnifi`'s wrapper records
 *   `seen` BEFORE calling `route`, so even a `route` that would throw still proves whether the
 *   guard let a request through — the assertion is on `seen`, never on catching that throw.
 */
import { describe, expect, test } from 'bun:test';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import { fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { GetOnlyHttpClient, UnifiNonGetRequest } from './resource.ts';

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
