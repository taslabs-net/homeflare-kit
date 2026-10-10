/**
 * `unifiHandlers.reconcile` builds the allowed PUT from `news`, never `olds` (red team round 1,
 * mutation gap), and anchors it to the CONFIGURED base URL read from the credentials.
 *
 * ★ A probe spec whose `describe` is constant, so `updateReconcile`'s identity check passes and the
 *   ONLY thing separating `news.id` from `olds.id` is the wire guard's allow entry.
 */
import { describe, expect, test } from 'bun:test';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import { FAKE_BASE, FAKE_KEY, fakeUnifi, fakeUnifiLayer } from './fake-unifi.ts';
import { type UnifiSpec, unifiHandlers } from './resource.ts';

interface Probe {
  id: string;
}
interface State {
  written: boolean;
}

const probe: UnifiSpec<Probe, State, State, unknown, never> = {
  type: 'Test.Probe',
  describe: () => 'probe',
  fetchLive: () =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const res = yield* client.execute(HttpClientRequest.get(`${FAKE_BASE}/probe`));
      return (yield* res.json) as unknown as State;
    }) as never,
  attributes: (live) => live,
  matches: (a) => a.written,
  update: {
    allowedWrite: (props) => ({ method: 'PUT', tail: `/probe/${props.id}` }),
    // `id` differs between news and olds, so the patch is non-empty and the write really runs.
    patchKeys: ['id'],
    driftOf: () => [],
    checkScope: () => Effect.void,
    write: (_live, _patch, props) =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        const res = yield* client.execute(HttpClientRequest.put(`${FAKE_BASE}/probe/${props.id}`));
        return (yield* res.json) as unknown as State;
      }) as never,
  },
};

const config = ConfigProvider.layer(
  ConfigProvider.fromUnknown({
    UNIFI_NETWORK_API_BASE_URL: FAKE_BASE,
    UNIFI_NETWORK_API_KEY: FAKE_KEY,
  }),
);

const reconcile = (news: Probe, olds: Probe) => {
  let written = false;
  const fake = fakeUnifi((method) => {
    if (method === 'PUT') written = true;
    return Response.json({ written });
  });
  const exit = Effect.runPromiseExit(
    unifiHandlers(probe)
      .reconcile({ news, olds, output: { written: false }, session: { note: () => Effect.void } })
      .pipe(Effect.provide(Layer.mergeAll(fakeUnifiLayer(fake.fetch), config))) as never,
  );
  return { fake, exit };
};

describe('unifiHandlers.reconcile allow entry', () => {
  test('is built from news: a PUT to news.id passes even though olds.id differs', async () => {
    const { fake, exit } = reconcile({ id: 'NEW' }, { id: 'OLD' });
    expect(Exit.isSuccess(await exit)).toBe(true);
    expect(fake.seen.filter((s) => s.method === 'PUT').map((s) => s.path)).toEqual([
      '/proxy/network/integration/probe/NEW',
    ]);
  });
});
