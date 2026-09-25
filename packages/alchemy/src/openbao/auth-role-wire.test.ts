import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { judgeAuthRoleRename } from './auth-role-identity.ts';
import { deleteAuthRole, readAuthRole, writeAuthRole } from './auth-role-wire.ts';
import { run, runFailure, withFake } from './fake-bao.ts';

const PROPS = {
  name: 'host-cert',
  tokenPolicies: ['host-cert'],
  tokenTtl: '15m',
  tokenMaxTtl: '1h',
  secretIdTtl: '2160h',
};
const DATA = {
  bind_secret_id: true,
  secret_id_num_uses: 0,
  secret_id_ttl: 7776000,
  token_max_ttl: 3600,
  token_policies: ['host-cert'],
  token_ttl: 900,
};

test('metadata SDK POST preserves omission/false/zero and never sends credential IDs', async () => {
  await withFake(
    () => ({ status: 204 }),
    async (bao) => {
      const env = { BAO_ADDR: bao.address, BAO_NAMESPACE: 'fixture', BAO_TOKEN: 'fake-token' };
      await run(env, writeAuthRole(PROPS));
      await run(env, writeAuthRole({ ...PROPS, bindSecretId: false, secretIdNumUses: 0 }));
      expect(bao.seen.map(({ method }) => method)).toEqual(['POST', 'POST']);
      const [first, second] = bao.seen;
      if (first === undefined || second === undefined) throw new Error('expected both SDK writes');
      expect(first.path).toBe('/v1/auth/approle/role/host-cert');
      expect(first.headers.get('x-vault-request')).toBe('true');
      expect(first.headers.get('x-vault-namespace')).toBe('fixture');
      expect(JSON.parse(first.body)).toEqual({
        token_policies: ['host-cert'],
        token_ttl: 900,
        token_max_ttl: 3600,
        secret_id_ttl: 7776000,
      });
      expect(JSON.parse(second.body)).toEqual({
        ...JSON.parse(first.body),
        bind_secret_id: false,
        secret_id_num_uses: 0,
      });
    },
  );
});

for (const [status, tag] of [
  [401, 'Unauthorized'],
  [403, 'Forbidden'],
  [500, 'InternalServerError'],
] as const) {
  test(`metadata SDK ${status} propagates for every verb and collision reads without retry`, async () => {
    await withFake(
      () => ({ status, json: { errors: ['refused'] } }),
      async (bao) => {
        const env = { BAO_ADDR: bao.address };
        for (const op of [
          Effect.asVoid(readAuthRole('host-cert')),
          Effect.asVoid(writeAuthRole(PROPS)),
          Effect.asVoid(deleteAuthRole('host-cert')),
          Effect.asVoid(judgeAuthRoleRename({ name: 'old' }, { name: 'new' }, undefined)),
        ])
          expect(await runFailure(env, op)).toMatchObject({ _tag: tag });
        expect(bao.seen.map(({ method }) => method)).toEqual(['GET', 'POST', 'DELETE', 'GET']);
      },
    );
  });
}

test('typed missing read is absence and missing delete is success', async () => {
  await withFake(
    () => ({ status: 404, json: { errors: [] } }),
    async (bao) => {
      const env = { BAO_ADDR: bao.address };
      expect(await run(env, readAuthRole('gone'))).toBeUndefined();
      await run(env, deleteAuthRole('gone'));
      expect(bao.seen).toHaveLength(2);
    },
  );
});

test('a malformed 200 never supplies role defaults or becomes absence', async () => {
  for (const data of [
    null,
    {},
    { ...DATA, token_policies: 'host-cert' },
    { ...DATA, bind_secret_id: 'true' },
    { ...DATA, token_ttl: -1 },
  ]) {
    await withFake(
      () => ({ status: 200, json: { data } }),
      async (bao) => {
        expect(
          String(await runFailure({ BAO_ADDR: bao.address }, readAuthRole('host-cert'))),
        ).toContain('incomplete role metadata');
      },
    );
  }
});

test('unmanaged nullable vendor fields do not prevent a valid metadata read', async () => {
  await withFake(
    () => ({ status: 200, json: { data: { ...DATA, secret_id_bound_cidrs: null } } }),
    async (bao) => {
      expect(await run({ BAO_ADDR: bao.address }, readAuthRole('host-cert'))).toMatchObject(DATA);
    },
  );
});

test('invalid TTL conversion refuses before any SDK exchange', async () => {
  await withFake(
    () => ({ status: 204 }),
    async (bao) => {
      for (const tokenTtl of ['invalid', '999999999999999999999999999h']) {
        expect(
          String(
            await runFailure({ BAO_ADDR: bao.address }, writeAuthRole({ ...PROPS, tokenTtl })),
          ),
        ).toContain('invalid role TTL');
      }
      expect(bao.seen).toEqual([]);
    },
  );
});
