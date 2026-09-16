/**
 * The unix-socket path, against a fake agent listener on Bun.serve's `unix` option.
 *
 * ★ An OpenBao Agent `listener "unix"` serves the API on a socket; BAO_ADDR / BAO_AGENT_ADDR name
 *   it as `unix:///path`. These prove the request really leaves over the socket — through the real
 *   FetchHttpClient layer, with no TCP server to fall back on.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { baoDelete, baoRead } from './bao-http.ts';
import { fakeBao, run, withFake } from './fake-bao.ts';

const socketPath = (label: string) => {
  const path = join(tmpdir(), `fake-bao-${label}-${String(process.pid)}.sock`);
  rmSync(path, { force: true });
  return path;
};

describe('a unix:// address', () => {
  it('reads over the socket, in agent mode, with the namespace', async () => {
    const path = socketPath('read');
    await withFake(
      () => ({ json: { data: { type: 'kv' } }, status: 200 }),
      async (agent) => {
        const env = { BAO_ADDR: agent.address, BAO_NAMESPACE: 'homeflare' };
        assert.deepEqual(await run(env, baoRead('sys/mounts/kv')), { type: 'kv' });
        assert.equal(agent.seen[0]?.path, '/v1/sys/mounts/kv');
        assert.equal(agent.seen[0]?.headers.get('x-vault-namespace'), 'homeflare');
        assert.equal(agent.seen[0]?.headers.has('x-vault-token'), false);
      },
      path,
    );
    rmSync(path, { force: true });
  });

  it('classifies over the socket the same way: 404 read absent, 404 delete success', async () => {
    const path = socketPath('absent');
    await withFake(
      () => ({ json: { errors: [] }, status: 404 }),
      async (agent) => {
        const env = { BAO_ADDR: agent.address };
        assert.equal(await run(env, baoRead('pki/roles/zz')), undefined);
        await run(env, baoDelete('pki/roles/zz'));
        assert.equal(agent.seen.length, 2);
      },
      path,
    );
    rmSync(path, { force: true });
  });

  // ★ api/client.go:761-762 — BAO_AGENT_ADDR wins. BAO_ADDR here points at a server that is gone,
  //   so the call only succeeds if it went to the agent socket.
  it('prefers a BAO_AGENT_ADDR socket over BAO_ADDR', async () => {
    const gone = fakeBao(() => ({ status: 200 }));
    gone.stop();
    const path = socketPath('agent');
    await withFake(
      () => ({ json: { data: { ok: true } }, status: 200 }),
      async (agent) => {
        const env = { BAO_ADDR: gone.address, BAO_AGENT_ADDR: agent.address };
        assert.deepEqual(await run(env, baoRead('kv/config')), { ok: true });
      },
      path,
    );
    rmSync(path, { force: true });
  });
});
