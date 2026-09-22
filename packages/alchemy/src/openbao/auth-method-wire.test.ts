/**
 * Bao.AuthMethod's calls against a fake. A missing method is a 400, not a 404 —
 * the same trap as secrets mounts (mount-wire.ts). Only the auth table may
 * turn that 400 into "absent".
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  disableAuthMethod,
  enableAuthMethod,
  readAuthMethodData,
  tuneAuthMethod,
} from './auth-method-wire.ts';
import { BaoError } from './bao-status.ts';
import { type Reply, type Seen, run, runFailure, withFake } from './fake-bao.ts';

const NO_AUTH = { json: { errors: ['No auth engine at approle-new/'] }, status: 400 };
const table = (...paths: string[]) => ({
  json: { data: Object.fromEntries(paths.map((path) => [path, { type: 'approle' }])) },
  status: 200,
});

const routes = (method: Reply, listing: Reply) => (seen: Seen) =>
  seen.path === '/v1/sys/auth' ? listing : method;

const statusOf = async (error: Promise<unknown>) => {
  const settled = await error;
  assert.ok(settled instanceof BaoError);
  return settled.status;
};

describe('readAuthMethodData', () => {
  it('reads a method that exists, without consulting the table', async () => {
    const reply = { json: { data: { config: {}, type: 'approle' } }, status: 200 };
    await withFake(routes(reply, table()), async (bao) => {
      const data = await run({ BAO_ADDR: bao.address }, readAuthMethodData('approle'));
      assert.equal(data?.['type'], 'approle');
      assert.deepEqual(
        bao.seen.map((seen) => seen.path),
        ['/v1/sys/auth/approle'],
      );
    });
  });

  it("reads a missing method as absent once the table confirms OpenBao's 400", async () => {
    await withFake(routes(NO_AUTH, table('token/', 'userpass/')), async (bao) => {
      assert.equal(
        await run({ BAO_ADDR: bao.address }, readAuthMethodData('approle-new/')),
        undefined,
      );
      assert.deepEqual(
        bao.seen.map((seen) => seen.path),
        ['/v1/sys/auth/approle-new', '/v1/sys/auth'],
      );
    });
  });

  it('keeps the 400 when the table lists the method after all', async () => {
    await withFake(routes(NO_AUTH, table('approle-new/')), async (bao) => {
      const error = runFailure({ BAO_ADDR: bao.address }, readAuthMethodData('approle-new'));
      assert.equal(await statusOf(error), 400);
    });
  });

  it('keeps the 400 when the table read is refused', async () => {
    const refused = { json: { errors: ['permission denied'] }, status: 403 };
    await withFake(routes(NO_AUTH, refused), async (bao) => {
      const error = runFailure({ BAO_ADDR: bao.address }, readAuthMethodData('approle-new'));
      assert.equal(await statusOf(error), 400);
    });
  });

  it('fails a refused method read (403) without consulting the table', async () => {
    const refused = { json: { errors: ['permission denied'] }, status: 403 };
    await withFake(routes(refused, table()), async (bao) => {
      const error = runFailure({ BAO_ADDR: bao.address }, readAuthMethodData('approle'));
      assert.equal(await statusOf(error), 403);
      assert.equal(bao.seen.length, 1);
    });
  });
});

describe('enable, tune, disable', () => {
  it('sends the endpoints and bodies configure-engines sent', async () => {
    await withFake(
      () => ({ status: 204 }),
      async (bao) => {
        const env = { BAO_ADDR: bao.address };
        const props = {
          description: 'Alchemy and CI machine login',
          path: 'approle/',
          type: 'approle',
        };
        await run(env, enableAuthMethod(props));
        await run(env, tuneAuthMethod(props));
        await run(env, disableAuthMethod('approle'));
        const calls = bao.seen.map((seen) => [seen.method, seen.path, seen.body]);
        assert.deepEqual(calls, [
          [
            'POST',
            '/v1/sys/auth/approle',
            JSON.stringify({ type: 'approle', description: 'Alchemy and CI machine login' }),
          ],
          [
            'POST',
            '/v1/sys/auth/approle/tune',
            JSON.stringify({ description: 'Alchemy and CI machine login' }),
          ],
          ['DELETE', '/v1/sys/auth/approle', ''],
        ]);
      },
    );
  });

  it('fails a refused enable with OpenBao errors', async () => {
    await withFake(
      () => ({ json: { errors: ['path is already in use at approle/'] }, status: 400 }),
      async (bao) => {
        const error = runFailure(
          { BAO_ADDR: bao.address },
          enableAuthMethod({ path: 'approle', type: 'approle' }),
        );
        assert.equal(await statusOf(error), 400);
      },
    );
  });
});
