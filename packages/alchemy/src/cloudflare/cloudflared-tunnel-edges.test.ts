/**
 * CloudflaredTunnelProvider's refusals and recoveries — the cases a mutation of each guard must
 * break: the two-match refusal, the tunnel-type check, the tombstone check, the 404 on a stored id,
 * the stored account, the 1013 race, the `local` refusal and delete's id precondition.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import { extra, ids, read, reconcile, run, stored, writes } from './cloudflared-tunnel-harness.ts';
import { FAKE_ACCOUNT, fakeFailure } from './fake-mesh.ts';
import { fakeTunnels } from './fake-tunnel.ts';

const OTHER_ACCOUNT = '00000000000000000000000000000002';
const UNKNOWN_ID = '00000000-0000-4000-9000-00000000ffff';
const props = { name: 'k8s-admin' };

describe('CloudflaredTunnelProvider edges', () => {
  test('lookups filter by name, live-only and cfd_tunnel on the wire', async () => {
    const fake = fakeTunnels();
    await run(fake, (p) => read(p, props));
    const list = fake.seen.find((s) => s.method === 'GET');
    expect(list?.path).toContain('/tunnels?');
    expect(list?.path).toContain('name=k8s-admin');
    expect(list?.path).toContain('is_deleted=false');
    expect(list?.path).toContain('tun_types=cfd_tunnel');
  });

  test('a prefix-only match, a deleted tunnel and a Mesh node of the same name are not adopted', async () => {
    const fake = fakeTunnels();
    fake.seed({ name: 'k8s-admin-2' });
    fake.seed({ name: 'k8s-admin', deleted_at: '2026-10-08T00:00:00Z' });
    // ⚠️ The fake's list honours tun_types, so this proves the client's own re-check by id: GET.
    fake.seed({ name: 'k8s-admin', tun_type: 'warp_connector' });
    expect(await run(fake, (p) => read(p, props))).toBeUndefined();
    const mesh = [...fake.tunnels.values()].find((t) => t.tun_type === 'warp_connector');
    const viaId = stored(FAKE_ACCOUNT, { id: mesh?.id ?? '' });
    expect(await run(fake, (p) => read(p, { name: 'zz' }, viaId))).toBeUndefined();
  });

  test('two live tunnels with the declared name are refused, both named', async () => {
    const fake = fakeTunnels();
    const a = fake.seed({ name: 'k8s-admin' });
    const b = fake.seed({ name: 'k8s-admin' });
    const failure = await run(fake, (p) => Effect.flip(read(p, props)));
    expect(failure.message).toContain(a.id);
    expect(failure.message).toContain(b.id);
  });

  test('a stored id the API no longer knows (404): read falls back to the name, reconcile creates', async () => {
    const fake = fakeTunnels();
    const tunnel = fake.seed({ name: 'k8s-admin' });
    const gone = stored(FAKE_ACCOUNT, { id: UNKNOWN_ID, name: 'k8s-other' });
    const probe = await run(fake, (p) => read(p, props, gone));
    expect(Unowned.is(probe)).toBe(true);
    expect(probe).toMatchObject({ id: tunnel.id });

    const fresh = fakeTunnels();
    const created = await run(fresh, (p) => reconcile(p, { name: 'k8s-other' }, gone));
    expect(created.id).not.toBe(UNKNOWN_ID);
    expect(writes(fresh)).toEqual(['POST']);
  });

  test('read refreshes in the account the tunnel was written to, not the current environment', async () => {
    const fake = fakeTunnels();
    const tunnel = fake.seed({ name: 'k8s-admin', status: 'healthy' });
    const output = stored(FAKE_ACCOUNT, { id: tunnel.id });
    // ⚠️ The fake throws on any other account, so reading in OTHER_ACCOUNT fails this test.
    const fresh = await run(fake, (p) => read(p, props, output), OTHER_ACCOUNT);
    expect(fresh).toMatchObject({ id: tunnel.id, accountId: FAKE_ACCOUNT, status: 'healthy' });
  });

  test('a rename onto a name another tunnel holds is refused, not forced', async () => {
    const fake = fakeTunnels();
    fake.seed({ name: 'k8s-taken' });
    const failure = await run(fake, (p) =>
      Effect.gen(function* () {
        const first = yield* reconcile(p, props);
        return yield* Effect.flip(reconcile(p, { name: 'k8s-taken' }, first));
      }),
    );
    expect(failure.message).toContain('already exists');
  });

  test('create never converges on a tunnel it did not create', async () => {
    const fake = fakeTunnels();
    fake.seed({ name: 'k8s-admin' });
    const failure = await run(fake, (p) => Effect.flip(reconcile(p, props)));
    expect(failure.message).toContain('already exists');
    expect(failure.message).toContain('do not delete it');
    expect(writes(fake)).toEqual([]);
  });

  test('a 1013 after a clean lookup names the tunnel that appeared, and does not adopt it', async () => {
    const fake = fakeTunnels({
      onCreate: (name) => {
        fake.seed({ name });
        return fakeFailure(409, 1013, 'tunnel with name already exists');
      },
    });
    const failure = await run(fake, (p) => Effect.flip(reconcile(p, props)));
    const holder = fake.live()[0];
    expect(failure.message).toContain(holder?.id ?? 'no holder');
    expect(failure.message).toContain('adopt(true)');
  });

  test('a locally configured tunnel is refused on adoption and left untouched', async () => {
    const fake = fakeTunnels();
    const tunnel = fake.seed({ name: 'k8s-admin', config_src: 'local' });
    const failure = await run(fake, (p) =>
      Effect.gen(function* () {
        const adopted = yield* read(p, props);
        return yield* Effect.flip(reconcile(p, props, adopted));
      }),
    );
    expect(failure.message).toContain('config_src local');
    expect(writes(fake)).toEqual([]);
    expect(fake.tunnels.get(tunnel.id)?.name).toBe('k8s-admin');
  });

  test('delete addresses the stored id only: a same-named newer tunnel survives', async () => {
    const fake = fakeTunnels();
    const old = fake.seed({ name: 'k8s-admin', deleted_at: '2026-10-08T00:00:00Z' });
    const newer = fake.seed({ name: 'k8s-admin' });
    await run(fake, (p) =>
      p.delete({ ...ids, ...extra, olds: props, output: stored(FAKE_ACCOUNT, { id: old.id }) }),
    );
    expect(writes(fake)).toEqual([]);
    expect(fake.live().map((t) => t.id)).toEqual([newer.id]);
  });

  test('delete refuses an empty id before any request', async () => {
    const fake = fakeTunnels();
    const failure = await run(fake, (p) =>
      Effect.flip(
        p.delete({ ...ids, ...extra, olds: props, output: stored(FAKE_ACCOUNT, { id: '' }) }),
      ),
    );
    expect(failure.message).toContain('empty id');
    expect(fake.seen).toHaveLength(0);
  });

  test('delete while connectors are attached surfaces the API refusal, and deletes nothing', async () => {
    const fake = fakeTunnels();
    const tunnel = fake.seed({ name: 'k8s-admin', connected: true });
    const failure = await run(fake, (p) =>
      Effect.flip(
        p.delete({
          ...ids,
          ...extra,
          olds: props,
          output: stored(FAKE_ACCOUNT, { id: tunnel.id }),
        }),
      ),
    );
    expect(String(JSON.stringify(failure))).toContain('active connections');
    expect(fake.live()).toHaveLength(1);
  });
});
