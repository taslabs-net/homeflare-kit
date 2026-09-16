/**
 * Bao.Mount's calls against a fake. The part worth pinning is the MISSING mount: OpenBao answers a
 * read of one with 400, not 404 (vault/logical_system.go:1171-1178), and only the mount table may
 * turn that into "absent".
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BaoError } from './bao-status.ts';
import { type Reply, type Seen, run, runFailure, withFake } from './fake-bao.ts';
import { disableMount, enableMount, readMountData, tuneMount } from './mount-wire.ts';

const NO_MOUNT = { json: { errors: ['No secret engine mount at zz-new/'] }, status: 400 };
const table = (...paths: string[]) => ({
  json: { data: Object.fromEntries(paths.map((path) => [path, { type: 'kv' }])) },
  status: 200,
});

/** Answer the mount read with `mount`, and the mount-table listing with `listing`. */
const routes = (mount: Reply, listing: Reply) => (seen: Seen) =>
  seen.path === '/v1/sys/mounts' ? listing : mount;

const statusOf = async (error: Promise<unknown>) => {
  const settled = await error;
  assert.ok(settled instanceof BaoError);
  return settled.status;
};

describe('readMountData', () => {
  it('reads a mount that exists, without consulting the table', async () => {
    const reply = { json: { data: { config: {}, type: 'pki' } }, status: 200 };
    await withFake(routes(reply, table()), async (bao) => {
      const data = await run({ BAO_ADDR: bao.address }, readMountData('pki'));
      assert.equal(data?.['type'], 'pki');
      assert.deepEqual(
        bao.seen.map((seen) => seen.path),
        ['/v1/sys/mounts/pki'],
      );
    });
  });

  it("reads a missing mount as absent once the table confirms OpenBao's 400", async () => {
    await withFake(routes(NO_MOUNT, table('kv/', 'pki/')), async (bao) => {
      assert.equal(await run({ BAO_ADDR: bao.address }, readMountData('zz-new/')), undefined);
      assert.deepEqual(
        bao.seen.map((seen) => seen.path),
        ['/v1/sys/mounts/zz-new', '/v1/sys/mounts'],
      );
    });
  });

  it('keeps the 400 when the table lists the mount after all', async () => {
    await withFake(routes(NO_MOUNT, table('zz-new/')), async (bao) => {
      const error = runFailure({ BAO_ADDR: bao.address }, readMountData('zz-new'));
      assert.equal(await statusOf(error), 400);
    });
  });

  it('keeps the 400 when the table read is refused', async () => {
    const refused = { json: { errors: ['permission denied'] }, status: 403 };
    await withFake(routes(NO_MOUNT, refused), async (bao) => {
      const error = runFailure({ BAO_ADDR: bao.address }, readMountData('zz-new'));
      assert.equal(await statusOf(error), 400);
    });
  });

  it('fails a refused mount read (403) without consulting the table', async () => {
    const refused = { json: { errors: ['permission denied'] }, status: 403 };
    await withFake(routes(refused, table()), async (bao) => {
      const error = runFailure({ BAO_ADDR: bao.address }, readMountData('kv'));
      assert.equal(await statusOf(error), 403);
      assert.equal(bao.seen.length, 1);
    });
  });
});

describe('enable, tune, disable', () => {
  it('sends the endpoints and bodies the CLI client sent', async () => {
    await withFake(
      () => ({ status: 204 }),
      async (bao) => {
        const env = { BAO_ADDR: bao.address };
        const props = { defaultLeaseTtl: '768h', path: 'kv/', type: 'kv', version: 2 as const };
        await run(env, enableMount(props));
        await run(env, tuneMount(props));
        await run(env, disableMount('kv'));
        const calls = bao.seen.map((seen) => [seen.method, seen.path, seen.body]);
        assert.deepEqual(calls, [
          ['POST', '/v1/sys/mounts/kv', JSON.stringify({ options: { version: '2' }, type: 'kv' })],
          ['POST', '/v1/sys/mounts/kv/tune', JSON.stringify({ default_lease_ttl: '768h' })],
          ['DELETE', '/v1/sys/mounts/kv', ''],
        ]);
      },
    );
  });

  it('fails a refused enable with OpenBao errors', async () => {
    await withFake(
      () => ({ json: { errors: ['path is already in use at kv/'] }, status: 400 }),
      async (bao) => {
        const error = runFailure(
          { BAO_ADDR: bao.address },
          enableMount({ path: 'kv', type: 'kv' }),
        );
        assert.equal(await statusOf(error), 400);
      },
    );
  });
});
