/**
 * The HTTP client against a fake OpenBao on Bun.serve: status classification end to end, the
 * namespace header, the token header present with BAO_TOKEN and ABSENT in agent mode, and the
 * token kept out of every error and every span.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Effect from 'effect/Effect';
import * as Headers from 'effect/unstable/http/Headers';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import { BaoEnv, baoDelete, baoRead, baoWrite } from './bao-http.ts';
import { BaoError } from './bao-status.ts';
import { fakeBao, run, runFailure, withFake } from './fake-bao.ts';

const TOKEN = 'hvs.FAKE-sentinel-never-a-real-token';
const NONE = { errors: [] };

const keepsTokenOut = (error: unknown) => {
  assert.ok(error instanceof BaoError);
  assert.ok(!error.message.includes(TOKEN), 'token in message');
  assert.ok(!JSON.stringify(error).includes(TOKEN), 'token in JSON');
  assert.ok(!Bun.inspect(error).includes(TOKEN), 'token in inspect');
  return error;
};

describe('baoRead', () => {
  it('returns data, sending the token, the namespace and X-Vault-Request', async () => {
    const reply = { json: { data: { mint_user: 'hf-read@pve', ttl: 3600 } }, status: 200 };
    await withFake(
      () => reply,
      async (bao) => {
        const env = { BAO_ADDR: bao.address, BAO_NAMESPACE: 'homeflare', BAO_TOKEN: TOKEN };
        const data = await run(env, baoRead('proxmox-tb4/roles/read'));
        assert.deepEqual(data, { mint_user: 'hf-read@pve', ttl: 3600 });
        const [seen] = bao.seen;
        assert.equal(seen?.method, 'GET');
        assert.equal(seen?.path, '/v1/proxmox-tb4/roles/read');
        assert.equal(seen?.headers.get('x-vault-namespace'), 'homeflare');
        assert.equal(seen?.headers.get('x-vault-token'), TOKEN);
        assert.equal(seen?.headers.get('x-vault-request'), 'true');
      },
    );
  });

  // ★ AGENT MODE: the listener injects its auto-auth token only into a request that carries none.
  it('sends no token header at all when BAO_TOKEN is unset', async () => {
    await withFake(
      () => ({ json: { data: {} }, status: 200 }),
      async (bao) => {
        await run({ BAO_ADDR: bao.address }, baoRead('kv/config'));
        assert.equal(bao.seen[0]?.headers.has('x-vault-token'), false);
        assert.equal(bao.seen[0]?.headers.has('x-vault-namespace'), false);
      },
    );
  });

  it('reads a 404 as absent', async () => {
    await withFake(
      () => ({ json: NONE, status: 404 }),
      async (bao) => {
        assert.equal(await run({ BAO_ADDR: bao.address }, baoRead('pki/roles/zz')), undefined);
      },
    );
  });

  it('fails a 403 with OpenBao errors and without the token', async () => {
    const denied = {
      json: { errors: ['1 error occurred:\n\t* permission denied\n\n'] },
      status: 403,
    };
    await withFake(
      () => denied,
      async (bao) => {
        const env = { BAO_ADDR: bao.address, BAO_TOKEN: TOKEN };
        const error = keepsTokenOut(await runFailure(env, baoRead('sys/policies/acl/x')));
        assert.equal(error.status, 403);
        assert.deepEqual(error.errors, denied.json.errors);
      },
    );
  });

  it('fails a sealed server (503)', async () => {
    await withFake(
      () => ({ json: { errors: ['Vault is sealed'] }, status: 503 }),
      async (bao) => {
        const env = { BAO_ADDR: bao.address, BAO_TOKEN: TOKEN };
        assert.equal(keepsTokenOut(await runFailure(env, baoRead('kv/config'))).status, 503);
      },
    );
  });

  it('fails a server that is not listening, as no response', async () => {
    const gone = fakeBao(() => ({ status: 200 }));
    gone.stop();
    const env = { BAO_ADDR: gone.address, BAO_TOKEN: TOKEN };
    const error = keepsTokenOut(await runFailure(env, baoRead('kv/config')));
    assert.equal(error.status, 0);
    assert.match(error.message, /-> no response: /);
  });

  // ⛔ Effect writes request headers onto the client span; the token must be a redacted name.
  it('adds x-vault-token to the header names Effect redacts', async () => {
    let names: ReadonlyArray<RegExp | string> = [];
    const recording = HttpClient.make((request, _url, _signal, fiber) => {
      names = fiber.getRef(Headers.CurrentRedactedNames);
      const response = new Response('{"data":{}}', { status: 200 });
      return Effect.succeed(HttpClientResponse.fromWeb(request, response));
    });
    await Effect.runPromise(
      baoRead('kv/config').pipe(
        Effect.provideService(BaoEnv, { BAO_ADDR: 'http://fake.invalid', BAO_TOKEN: TOKEN }),
        Effect.provideService(HttpClient.HttpClient, recording),
      ),
    );
    assert.ok(names.includes('x-vault-token'));
    assert.ok(names.includes('authorization'), 'the defaults are kept');
  });
});

describe('baoDelete', () => {
  it('succeeds on a 404 — already gone — and on a 204', async () => {
    for (const reply of [{ json: NONE, status: 404 }, { status: 204 }]) {
      await withFake(
        () => reply,
        async (bao) => {
          await run({ BAO_ADDR: bao.address }, baoDelete('ssh/roles/zz'));
          assert.equal(bao.seen[0]?.method, 'DELETE');
        },
      );
    }
  });

  it('fails a refused delete (403) and a sealed one (503)', async () => {
    for (const status of [403, 503]) {
      await withFake(
        () => ({ json: { errors: ['nope'] }, status }),
        async (bao) => {
          const error = await runFailure({ BAO_ADDR: bao.address }, baoDelete('ssh/roles/zz'));
          assert.equal(keepsTokenOut(error).status, status);
        },
      );
    }
  });
});

describe('baoWrite', () => {
  it('sends the body as JSON with its content type, and fails a 404', async () => {
    await withFake(
      (seen) => (seen.path === '/v1/ok/roles/x' ? { status: 204 } : { json: NONE, status: 404 }),
      async (bao) => {
        const env = { BAO_ADDR: bao.address };
        await run(env, baoWrite('PUT', 'ok/roles/x', { ttl: '3600' }));
        assert.equal(bao.seen[0]?.headers.get('content-type'), 'application/json');
        assert.deepEqual(JSON.parse(bao.seen[0]?.body ?? ''), { ttl: '3600' });
        const error = await runFailure(env, baoWrite('PUT', 'nope/roles/x', { ttl: '1' }));
        assert.equal(keepsTokenOut(error).status, 404);
      },
    );
  });
});
