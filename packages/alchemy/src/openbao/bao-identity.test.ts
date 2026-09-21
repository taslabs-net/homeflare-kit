/**
 * assertBaoIdentity against a fake. The parts worth pinning: health goes out with NO token and NO
 * namespace header (root-only API), a mismatch refuses before anything else is asked, and a
 * missing namespace is a refusal rather than a quiet fall-through to root.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BaoIdentityError,
  HEALTH_PATH,
  NAMESPACE_PROBE_PATH,
  assertBaoIdentity,
  assertBaoIdentityEffect,
} from './bao-identity.ts';
import { type Reply, type Seen, run, runFailure, withFake } from './fake-bao.ts';

const HEALTHY = {
  cluster_id: '00000000-0000-4000-8000-000000000001',
  cluster_name: 'vault-example',
  initialized: true,
  sealed: false,
  standby: false,
  version: '2.6.2',
};

const routes =
  (health: Reply, probe: Reply = { json: { data: { auth: {}, secret: {} } }, status: 200 }) =>
  (seen: Seen) =>
    seen.path.startsWith('/v1/sys/health') ? health : probe;

const EXPECT = { clusterName: 'vault-example', namespace: 'team-a' };
const envOf = (address: string) => ({
  BAO_ADDR: address,
  BAO_NAMESPACE: 'team-a',
  BAO_TOKEN: 'placeholder-token',
});

const failureOf = async (promise: Promise<unknown>) => {
  const error = await promise;
  assert.ok(error instanceof BaoIdentityError);
  assert.match(error.message, /^REFUSING: /);
  return error;
};

describe('assertBaoIdentity', () => {
  it('passes a matching vault, sending no token anywhere and no namespace to health', async () => {
    await withFake(routes({ json: HEALTHY, status: 200 }), async (bao) => {
      const identity = await run(envOf(bao.address), assertBaoIdentityEffect(EXPECT));
      assert.equal(identity.clusterName, 'vault-example');
      assert.equal(identity.namespace, 'team-a');
      assert.equal(identity.version, '2.6.2');
      const [health, probe] = bao.seen;
      assert.equal(health?.path, `/v1/${HEALTH_PATH}`);
      assert.equal(health?.headers.get('x-vault-namespace'), null);
      assert.equal(probe?.path, `/v1/${NAMESPACE_PROBE_PATH}`);
      assert.equal(probe?.headers.get('x-vault-namespace'), 'team-a');
      for (const seen of bao.seen) assert.equal(seen.headers.get('x-vault-token'), null);
    });
  });

  it('refuses the wrong cluster and asks nothing more', async () => {
    const other = { ...HEALTHY, cluster_name: 'vault-other' };
    await withFake(routes({ json: other, status: 200 }), async (bao) => {
      const error = await failureOf(
        runFailure(envOf(bao.address), assertBaoIdentityEffect(EXPECT)),
      );
      assert.equal(error.reason, 'mismatch');
      assert.match(error.message, /vault-other/);
      assert.equal(bao.seen.length, 1);
    });
  });

  it('refuses a sealed vault as unconfirmed, because sealed hides cluster_name', async () => {
    const sealed = { initialized: true, sealed: true, standby: true, version: '2.6.2' };
    await withFake(routes({ json: sealed, status: 200 }), async (bao) => {
      const error = await failureOf(
        runFailure(envOf(bao.address), assertBaoIdentityEffect(EXPECT)),
      );
      assert.equal(error.reason, 'unconfirmed');
    });
  });

  it('refuses a BAO_NAMESPACE that is not the expected one without calling out', async () => {
    await withFake(routes({ json: HEALTHY, status: 200 }), async (bao) => {
      const env = { ...envOf(bao.address), BAO_NAMESPACE: '' };
      const error = await failureOf(runFailure(env, assertBaoIdentityEffect(EXPECT)));
      assert.equal(error.reason, 'mismatch');
      assert.match(error.message, /`root`/);
      assert.equal(bao.seen.length, 0);
    });
  });

  it('refuses when the namespace does not exist on that cluster', async () => {
    const missing = { json: { errors: ['namespace not found'] }, status: 404 };
    await withFake(routes({ json: HEALTHY, status: 200 }, missing), async (bao) => {
      const error = await failureOf(
        runFailure(envOf(bao.address), assertBaoIdentityEffect(EXPECT)),
      );
      assert.equal(error.reason, 'mismatch');
      assert.match(error.message, /no namespace `team-a`/);
    });
  });

  it('skips the probe for the root namespace, however it is spelled', async () => {
    await withFake(routes({ json: HEALTHY, status: 200 }), async (bao) => {
      const env = { BAO_ADDR: bao.address, BAO_NAMESPACE: 'root' };
      await run(env, assertBaoIdentityEffect({ clusterName: 'vault-example', namespace: '/' }));
      assert.equal(bao.seen.length, 1);
    });
  });

  it('refuses a 200 that is not an OpenBao health body', async () => {
    await withFake(routes({ json: { ok: true }, status: 200 }), async (bao) => {
      const error = await failureOf(
        runFailure(envOf(bao.address), assertBaoIdentityEffect(EXPECT)),
      );
      assert.equal(error.reason, 'unconfirmed');
    });
  });

  it('rejects the Promise form with the BaoIdentityError itself', async () => {
    const other = { ...HEALTHY, cluster_name: 'vault-other' };
    await withFake(routes({ json: other, status: 200 }), async (bao) => {
      const error = await assertBaoIdentity({ ...EXPECT, env: envOf(bao.address) }).then(
        () => undefined,
        (rejection: unknown) => rejection,
      );
      await failureOf(Promise.resolve(error));
    });
  });
});
