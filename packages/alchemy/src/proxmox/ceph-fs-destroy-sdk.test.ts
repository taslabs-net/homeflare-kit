/** The real SDK must send destructive flags in the query and fold only its missing-FS tag. */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { destroyFs } from './ceph-fs-distilled.ts';
import { FAKE_TARGET, withoutBao } from './fake-pve.ts';

const props = { name: 'oldfs', node: 'node-b', target: FAKE_TARGET };
const UPID = 'UPID:node-b:fake:destroyfs';
const fixture = (answer: () => Response) => {
  const calls: { method: string; path: string; body: string }[] = [];
  const stub = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname.includes('/creds/')) {
      return Response.json({
        data: { secret: 'fake-secret-not-real', token_id: 'hf-test@pve!fake' },
        lease_duration: 0,
      });
    }
    calls.push({
      method: request.method,
      path: url.pathname + url.search,
      body: await request.text(),
    });
    return request.method === 'DELETE'
      ? answer()
      : Response.json({ data: { status: 'stopped', exitstatus: 'OK' } });
  };
  const layer = FetchHttpClient.layer.pipe(
    Layer.provideMerge(
      Layer.succeed(
        FetchHttpClient.Fetch,
        Object.assign(stub, { preconnect: globalThis.fetch.preconnect }) as typeof fetch,
      ),
    ),
  );
  return { calls, layer };
};

describe('CephFS distilled delete', () => {
  test('destructive flags reach the query, never the DELETE body, and the worker is polled', async () => {
    const fake = fixture(() => Response.json({ data: UPID }));
    await withoutBao(() =>
      Effect.runPromise(
        destroyFs({ ...props, 'remove-pools': true, 'remove-storages': true }).pipe(
          Effect.provide(fake.layer),
        ),
      ),
    );
    expect(fake.calls[0]).toEqual({
      method: 'DELETE',
      path: '/api2/json/nodes/node-b/ceph/fs/oldfs?remove-pools=1&remove-storages=1',
      body: '',
    });
    expect(fake.calls[1]?.path).toBe(
      `/api2/json/nodes/node-b/tasks/${encodeURIComponent(UPID)}/status`,
    );
  });

  test('omitted or false flags preserve the safe defaults', async () => {
    const fake = fixture(() => Response.json({ data: UPID }));
    await withoutBao(() =>
      Effect.runPromise(
        destroyFs({ ...props, 'remove-pools': false }).pipe(Effect.provide(fake.layer)),
      ),
    );
    expect(fake.calls[0]).toEqual({
      method: 'DELETE',
      path: '/api2/json/nodes/node-b/ceph/fs/oldfs',
      body: '',
    });
  });

  test('a race that already removed the filesystem is idempotent without a task poll', async () => {
    const fake = fixture(() =>
      Response.json({ data: null, message: "no such cephfs 'oldfs'\n" }, { status: 500 }),
    );
    await withoutBao(() => Effect.runPromise(destroyFs(props).pipe(Effect.provide(fake.layer))));
    expect(fake.calls).toHaveLength(1);
  });

  for (const status of [401, 403, 500]) {
    test(`an unrelated HTTP ${String(status)} fails instead of claiming deletion`, async () => {
      const fake = fixture(() =>
        Response.json({ data: null, message: 'refused or unavailable' }, { status }),
      );
      await withoutBao(async () => {
        await expect(
          Effect.runPromise(destroyFs(props).pipe(Effect.provide(fake.layer))),
        ).rejects.toBeDefined();
      });
      expect(fake.calls).toHaveLength(1);
    });
  }
});
