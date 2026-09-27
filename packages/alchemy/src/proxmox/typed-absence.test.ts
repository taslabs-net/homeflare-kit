/**
 * A failed read is not evidence of absence. Exercise the real SDK's protocol and errors,
 * including PVE's resource-specific HTTP 500s, before checking the engine's write boundary.
 * Fixtures come from the vendor-source evidence in the SDK's generated error declarations.
 * All HTTP is in-process, and `withoutBao` removes the shell's real credentials.
 */
import { describe, expect, test } from 'bun:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { engineOver } from '../verify/fake-engine.ts';
import { readDaemon } from './ceph-daemon-wire.ts';
import { readFs } from './ceph-fs-distilled.ts';
import { ProxmoxCephFs, ProxmoxCephFsProvider } from './ceph-fs.ts';
import { readPoolStatus } from './ceph-pool-wire.ts';
import { FAKE_TARGET, withoutBao } from './fake-pve.ts';
import { readGroup } from './group-wire.ts';
import { readStorage } from './storage-wire.ts';
import { readUser } from './user-wire.ts';
import { ProxmoxUser, ProxmoxUserProvider } from './user.ts';

const target = FAKE_TARGET;
const ceph = { name: 'testfs', node: 'node-b', target };
const user = { userid: 'test@pve', target };

/** A mutable answer lets a formerly readable filesystem fail exactly when delete runs. */
const cluster = (initial: () => Response) => {
  let answer = initial;
  const writes: string[] = [];
  const stub = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    if (new URL(request.url).pathname.includes('/creds/')) {
      const data = { secret: 'fake-secret-not-real', token_id: 'hf-test@pve!fake' };
      return Response.json({ data, lease_duration: 0 });
    }
    if (request.method !== 'GET') writes.push(request.method);
    return answer();
  };
  return {
    answer: (next: () => Response) => {
      answer = next;
    },
    layer: FetchHttpClient.layer.pipe(
      Layer.provideMerge(
        Layer.succeed(
          FetchHttpClient.Fetch,
          Object.assign(stub, { preconnect: globalThis.fetch.preconnect }) as typeof fetch,
        ),
      ),
    ),
    writes,
  };
};

interface ReadCase {
  name: string;
  read: () => Effect.Effect<unknown, unknown, HttpClient.HttpClient>;
  missing?: string;
}
const cases: ReadCase[] = [
  { name: 'User', read: () => readUser(user), missing: "no such user ('test@pve')\n" },
  {
    name: 'Group',
    read: () => readGroup({ groupid: 'test', target }),
    missing: "group 'test' does not exist\n",
  },
  {
    name: 'Storage',
    read: () => readStorage({ storage: 'test', type: 'dir', target }),
    missing: "storage 'test' does not exist\n",
  },
  {
    name: 'CephPool',
    read: () => readPoolStatus(ceph),
    missing: "error with 'osd pool get': mon_cmd failed - unrecognized pool 'testfs'\n",
  },
  { name: 'CephFs', read: () => readFs(ceph) },
  ...(['mon', 'mgr', 'mds'] as const).map((kind) => ({
    name: `CephDaemon/${kind}`,
    read: () => readDaemon({ ...ceph, kind }),
  })),
];
const errorResponse = (status: number, message: string) => () =>
  Response.json({ data: null, message }, { status });

for (const entry of cases) {
  describe(entry.name, () => {
    test('only the measured absence signal returns undefined', async () => {
      const fake = cluster(
        entry.missing === undefined
          ? () => Response.json({ data: [] })
          : errorResponse(500, entry.missing),
      );
      await withoutBao(async () => {
        expect(
          await Effect.runPromise(entry.read().pipe(Effect.provide(fake.layer))),
        ).toBeUndefined();
      });
      expect(fake.writes).toEqual([]);
    });
    for (const [status, tag] of [
      [401, 'Unauthorized'],
      [403, 'Forbidden'],
      [500, 'InternalServerError'],
    ] as const) {
      test(`${status} unrelated failure propagates ${tag}`, async () => {
        const fake = cluster(errorResponse(status, 'unrelated read failure'));
        await withoutBao(async () => {
          const error = await Effect.runPromise(
            entry.read().pipe(Effect.flip, Effect.provide(fake.layer)),
          );
          expect(error).toMatchObject({ _tag: tag });
        });
        expect(fake.writes).toEqual([]);
      });
    }
  });
}

test('a cold User adoption fails before any create when its read fails', async () => {
  const fake = cluster(errorResponse(500, 'unrelated read failure'));
  await withoutBao(async () => {
    const engine = engineOver(ProxmoxUserProvider().pipe(Layer.provideMerge(fake.layer)));
    await expect(engine.deploy(ProxmoxUser('test', user))).rejects.toBeDefined();
  });
  expect(fake.writes).toEqual([]);
});

test('CephFs delete fails on an unreadable index instead of falsely dropping state', async () => {
  const fake = cluster(() =>
    Response.json({
      data: [{ name: ceph.name, data_pool: 'testfs_data', metadata_pool: 'testfs_metadata' }],
    }),
  );
  await withoutBao(async () => {
    const engine = engineOver(ProxmoxCephFsProvider().pipe(Layer.provideMerge(fake.layer)));
    const declared = () => ProxmoxCephFs('fs', ceph).pipe(RemovalPolicy.destroy());
    expect(await engine.deploy(declared())).toEqual({ fs: 'adopted' });
    fake.answer(errorResponse(403, 'permission denied'));
    await expect(engine.deploy(Effect.void)).rejects.toBeDefined();
  });
  expect(fake.writes).toEqual([]);
});
