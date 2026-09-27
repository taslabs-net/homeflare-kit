/** AppRole metadata through the real SDK and Alchemy's upstream test harness; no real vault. */
import { afterAll, beforeEach, expect } from 'bun:test';
import { adopt } from 'alchemy/AdoptPolicy';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Test from 'alchemy/Test/Bun';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { BaoAuthRole, BaoAuthRoleProvider } from './auth-role.ts';
import { BaoEnv } from './bao-http.ts';
import { type Reply, fakeBao } from './fake-bao.ts';
import { wireRoles } from './fake-engines-roles.ts';
import { writesOf } from './fake-stack.ts';

const store = wireRoles();
let refused: Reply | undefined;
const bao = fakeBao((seen) =>
  seen.method === 'GET' && refused !== undefined ? refused : store(seen),
);
afterAll(() => bao.stop());
beforeEach(() => {
  store.live.clear();
  bao.seen.length = 0;
  refused = undefined;
});
const { test } = Test.make({
  adopt: true,
  dev: false,
  sidecar: false,
  stage: 'test',
  providers: Layer.mergeAll(
    BaoAuthRoleProvider(),
    FetchHttpClient.layer,
    Layer.succeed(BaoEnv, { BAO_ADDR: bao.address }),
  ),
});
const props = {
  name: 'host-cert',
  tokenPolicies: ['host-cert'],
  tokenTtl: '15m',
  tokenMaxTtl: '1h',
  secretIdTtl: '2160h',
};
const path = 'auth/approle/role/host-cert';
const existing = () =>
  store.live.set(path, {
    bind_secret_id: false,
    secret_id_num_uses: 7,
    secret_id_ttl: 7776000,
    token_max_ttl: 3600,
    token_policies: ['host-cert'],
    token_ttl: 900,
    token_period: 1800,
    secret_id_bound_cidrs: ['192.0.2.0/24'],
  });
const role = (tokenTtl = '15m') => BaoAuthRole('role', { ...props, tokenTtl });
const actions = (plan: { resources: Record<string, { action: string }> }) =>
  Object.values(plan.resources).map((row) => row.action);

test.provider('existing metadata adopts without writes, then plans and deploys noop', (scratch) =>
  Effect.gen(function* () {
    existing();
    yield* scratch.deploy(role());
    expect(writesOf(bao.seen)).toEqual([]);
    expect(actions(yield* scratch.plan(role()))).toEqual(['noop']);
    yield* scratch.deploy(role());
    expect(writesOf(bao.seen)).toEqual([]);
  }),
);

test.provider('drift writes one SDK POST and preserves omitted and unmanaged settings', (scratch) =>
  Effect.gen(function* () {
    existing();
    yield* scratch.deploy(role());
    yield* scratch.deploy(role('30m'));
    expect(writesOf(bao.seen)).toEqual(['POST /v1/auth/approle/role/host-cert']);
    expect(store.live.get(path)).toMatchObject({
      bind_secret_id: false,
      secret_id_num_uses: 7,
      token_period: 1800,
      token_ttl: 1800,
      secret_id_bound_cidrs: ['192.0.2.0/24'],
    });
    expect(actions(yield* scratch.plan(role('30m')))).toEqual(['noop']);
  }),
);

test.provider(
  'typed absence creates metadata with server defaults then settles to noop',
  (scratch) =>
    Effect.gen(function* () {
      yield* scratch.deploy(role());
      expect(writesOf(bao.seen)).toEqual(['POST /v1/auth/approle/role/host-cert']);
      expect(store.live.get(path)).toMatchObject({ bind_secret_id: true, secret_id_num_uses: 0 });
      expect(actions(yield* scratch.plan(role()))).toEqual(['noop']);
    }),
);

test.provider('occupied case-folded rename refuses before writes or deletes', (scratch) =>
  Effect.gen(function* () {
    existing();
    yield* scratch.deploy(role().pipe(RemovalPolicy.destroy()));
    store.live.set('auth/approle/role/taken', { ...store.live.get(path) });
    bao.seen.length = 0;
    const result = yield* Effect.exit(
      scratch.plan(BaoAuthRole('role', { ...props, name: 'TAKEN' })),
    );
    expect(result._tag).toBe('Failure');
    expect(writesOf(bao.seen)).toEqual([]);
  }),
);

test.provider('existing unowned role refuses without adoption', (scratch) =>
  Effect.gen(function* () {
    existing();
    expect((yield* Effect.exit(scratch.plan(role().pipe(adopt(false)))))._tag).toBe('Failure');
    expect(writesOf(bao.seen)).toEqual([]);
  }),
);

test.provider('destroy deletes only the recorded role and an empty redeploy is inert', (scratch) =>
  Effect.gen(function* () {
    yield* scratch.deploy(role().pipe(RemovalPolicy.destroy()));
    bao.seen.length = 0;
    yield* scratch.deploy(Effect.void);
    expect(writesOf(bao.seen)).toEqual(['DELETE /v1/auth/approle/role/host-cert']);
    expect(store.live.has(path)).toBe(false);
    bao.seen.length = 0;
    yield* scratch.deploy(Effect.void);
    expect(writesOf(bao.seen)).toEqual([]);
  }),
);

test.provider('default retain leaves removed role metadata untouched', (scratch) =>
  Effect.gen(function* () {
    yield* scratch.deploy(role());
    bao.seen.length = 0;
    yield* scratch.deploy(Effect.void);
    expect(writesOf(bao.seen)).toEqual([]);
    expect(store.live.has(path)).toBe(true);
  }),
);

for (const status of [200, 403]) {
  test.provider(`a malformed or denied ${status} read never becomes create or noop`, (scratch) =>
    Effect.gen(function* () {
      existing();
      yield* scratch.deploy(role());
      refused = { status, json: { data: {}, errors: ['refused'] } };
      expect((yield* Effect.exit(scratch.plan(role())))._tag).toBe('Failure');
      expect(writesOf(bao.seen)).toEqual([]);
      refused = undefined;
    }),
  );
}
