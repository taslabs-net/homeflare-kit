/**
 * Bao.Policy's calls against a fake that behaves like OpenBao where it matters: it STRIPS the
 * policy's trailing newline on write (measured on the live server — see digest.ts), answers 404 for
 * a policy it does not have, and 204 for a delete whether or not the policy existed.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BaoError } from './bao-status.ts';
import { sha256 } from './digest.ts';
import { type Seen, run, runFailure, withFake } from './fake-bao.ts';
import { deletePolicy, readPolicy, writePolicy } from './policy-wire.ts';

const PREFIX = '/v1/sys/policies/acl/';

const policyStore = () => {
  const policies = new Map<string, string>();
  return (seen: Seen) => {
    const name = seen.path.slice(PREFIX.length);
    if (seen.method === 'PUT') {
      const { policy } = JSON.parse(seen.body) as { policy: string };
      policies.set(name, policy.replace(/\n+$/, ''));
      return { status: 204 };
    }
    if (seen.method === 'DELETE') {
      policies.delete(name);
      return { status: 204 };
    }
    const policy = policies.get(name);
    return policy === undefined
      ? { json: { errors: [] }, status: 404 }
      : { json: { data: { name, policy } }, status: 200 };
  };
};

/** Two fragments, each followed by a newline — exactly how policy.ts assembles them. */
const ASSEMBLED = 'path "kv/data/a" {\n  capabilities = ["read"]\n}\n' + 'path "kv/data/b" {}\n';

describe('policy wire', () => {
  it('reads a policy that was never written as absent', async () => {
    await withFake(policyStore(), async (bao) => {
      assert.equal(await run({ BAO_ADDR: bao.address }, readPolicy('zz-new-policy')), '');
    });
  });

  // ⛔ THE FOREVER-DIFF. Live text comes back one newline short; the digests must still agree, or
  //    every plan says `update` and reconcile rewrites a policy that already matches.
  it('round-trips through the stripped newline with equal digests', async () => {
    await withFake(policyStore(), async (bao) => {
      const env = { BAO_ADDR: bao.address };
      await run(env, writePolicy('homeflare-llm', ASSEMBLED));
      assert.equal(bao.seen[0]?.method, 'PUT');
      assert.equal(bao.seen[0]?.path, `${PREFIX}homeflare-llm`);
      assert.deepEqual(JSON.parse(bao.seen[0]?.body ?? ''), { policy: ASSEMBLED });
      const live = await run(env, readPolicy('homeflare-llm'));
      assert.notEqual(live, ASSEMBLED, 'the fake strips the newline, as OpenBao does');
      assert.equal(sha256(live), sha256(ASSEMBLED));
    });
  });

  it('fails a refused read (403) instead of calling the policy absent', async () => {
    await withFake(
      () => ({ json: { errors: ['permission denied'] }, status: 403 }),
      async (bao) => {
        const error = await runFailure({ BAO_ADDR: bao.address }, readPolicy('homeflare-admin'));
        assert.ok(error instanceof BaoError);
        assert.equal(error.status, 403);
      },
    );
  });

  it('fails a 200 that carries no policy text', async () => {
    await withFake(
      () => ({ json: { data: { name: 'x' } }, status: 200 }),
      async (bao) => {
        const error = await runFailure({ BAO_ADDR: bao.address }, readPolicy('x'));
        assert.match(String(error), /no data\.policy/);
      },
    );
  });

  it('deletes idempotently: a policy already gone is success', async () => {
    await withFake(
      () => ({ json: { errors: [] }, status: 404 }),
      async (bao) => {
        await run({ BAO_ADDR: bao.address }, deletePolicy('zz-gone'));
        assert.equal(bao.seen[0]?.method, 'DELETE');
      },
    );
  });
});
