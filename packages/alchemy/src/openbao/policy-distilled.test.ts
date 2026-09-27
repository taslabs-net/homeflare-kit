import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { runFailure, withFake } from './fake-bao.ts';
import { aclPolicies, fakePolicyProviders } from './fake-engines.ts';
import { withFakeStack, writesOf } from './fake-stack.ts';
import { BaoPolicy } from './policy.ts';
import { judgePolicyRename } from './policy-identity.ts';
import { deletePolicy, readPolicy, writePolicy } from './policy-wire.ts';

for (const [status, tag] of [
  [401, 'Unauthorized'],
  [403, 'Forbidden'],
  [503, 'ServiceUnavailable'],
] as const) {
  test(`SDK policy ${status} failures propagate on every verb without retry`, async () => {
    await withFake(
      () => ({ status, json: { errors: ['refused'] } }),
      async (bao) => {
        const env = { BAO_ADDR: bao.address };
        for (const op of [
          Effect.asVoid(readPolicy('test')),
          writePolicy('test', 'path "test" {}'),
          deletePolicy('test'),
        ]) {
          expect(await runFailure(env, op)).toMatchObject({ _tag: tag });
        }
        expect(bao.seen.map(({ method }) => method)).toEqual(['GET', 'POST', 'DELETE']);
      },
    );
  });
}

test('SDK policy refuses null, non-string, and missing policy text on a successful read', async () => {
  for (const data of [null, {}, { policy: 42 }]) {
    await withFake(
      () => ({ status: 200, json: { data } }),
      async (bao) => {
        const error = await runFailure({ BAO_ADDR: bao.address }, readPolicy('test'));
        expect(String(error)).toContain('no data.policy');
      },
    );
  }
});

test('rename checks preserve an occupied empty policy and propagate denied SDK reads', async () => {
  await withFake(
    () => ({ status: 200, json: { data: { policy: '' } } }),
    async (bao) => {
      await expect(
        runFailure(
          { BAO_ADDR: bao.address },
          judgePolicyRename({ name: 'old' }, { name: 'new' }, undefined),
        ),
      ).rejects.toThrow('already exists');
    },
  );
  await withFake(
    () => ({ status: 403, json: { errors: ['refused'] } }),
    async (bao) => {
      expect(
        await runFailure(
          { BAO_ADDR: bao.address },
          judgePolicyRename({ name: 'old' }, { name: 'new' }, undefined),
        ),
      ).toMatchObject({ _tag: 'Forbidden' });
    },
  );
});

test('policy adoption and next deploy write nothing, while live drift writes one SDK POST', async () => {
  const store = aclPolicies();
  const path = 'sys/policies/acl/test';
  store.live.set(path, {
    name: 'test',
    policy: 'path "/policies/test/a.hcl" {\n  capabilities = ["read"]\n}',
  });
  await withFakeStack(fakePolicyProviders, store, async (stack, bao) => {
    const body = BaoPolicy('Policy', { name: 'test', fragments: '/policies/test' });
    expect(await stack.deploy(body, { adopt: true })).toEqual({ Policy: 'adopted' });
    expect(writesOf(bao.seen)).toEqual([]);
    expect(await stack.deploy(body)).toEqual({ Policy: 'noop' });
    store.live.set(path, { name: 'test', policy: 'path "drift" {}' });
    bao.seen.length = 0;
    expect(await stack.deploy(body)).toEqual({ Policy: 'update' });
    expect(writesOf(bao.seen)).toEqual(['POST /v1/sys/policies/acl/test']);
  });
});

test('a real empty policy is an existing unowned object, never a first-time create', async () => {
  const store = aclPolicies();
  store.live.set('sys/policies/acl/test', { name: 'test', policy: '' });
  await withFakeStack(fakePolicyProviders, store, async (stack, bao) => {
    await expect(
      stack.deploy(BaoPolicy('Policy', { name: 'test', fragments: '/policies/test' })),
    ).rejects.toThrow('not owned');
    expect(writesOf(bao.seen)).toEqual([]);
  });
});
