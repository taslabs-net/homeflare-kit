/**
 * CloudflaredTunnelProvider against a fake Cloudflare (fake-tunnel.ts), its handlers called the way
 * the engine calls them.
 *
 * ⛔ THE ASSERTION THAT MATTERS MOST: no lifecycle handler ever requests `/token`, and nothing the
 *   provider returns contains the tunnel token — even though the fake puts one on every wire object.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import type { StackServices } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import type * as Layer from 'effect/Layer';
import {
  diff,
  extra,
  ids,
  read,
  reconcile,
  run,
  stored,
  tokenReads,
  writes,
} from './cloudflared-tunnel-harness.ts';
import { FAKE_ACCOUNT, FAKE_API_TOKEN } from './fake-mesh.ts';
import { fakeTunnels } from './fake-tunnel.ts';
import { providers } from './providers.ts';

// ⛔ Compile-time: a stack's `providers` must be `Layer<…, never, StackServices>`.
type Built = Layer.Success<ReturnType<typeof providers>>;
const _stackShaped: Layer.Layer<Built, never, StackServices> = providers();
void _stackShaped;

const props = { name: 'k8s-admin' };

describe('CloudflaredTunnelProvider', () => {
  test('create sends config_src cloudflare and no secret, and the attributes carry no token', async () => {
    const fake = fakeTunnels();
    const out = await run(fake, (p) => reconcile(p, props));
    const post = fake.seen.find((s) => s.method === 'POST');
    expect(post?.body).toEqual({ name: 'k8s-admin', config_src: 'cloudflare' });
    expect(out).toMatchObject({ name: 'k8s-admin', accountId: FAKE_ACCOUNT });
    expect(Object.keys(out).sort()).toEqual(['accountId', 'id', 'name']);
    expect(JSON.stringify(out)).not.toContain('fake-tunnel-token');
    expect(tokenReads(fake)).toBe(0);
    expect(new Set(fake.auth)).toEqual(new Set([`Bearer ${FAKE_API_TOKEN}`]));
  });

  test('read with state refreshes by id; without state it adopts by exact name, Unowned', async () => {
    const fake = fakeTunnels();
    fake.seed({ name: 'k8s-admin-old' });
    fake.seed({ name: 'k8s-admin-older' });
    const tunnel = fake.seed({ name: 'k8s-admin', status: 'healthy' });
    const [owned, probe] = await run(fake, (p) =>
      Effect.gen(function* () {
        const output = stored(FAKE_ACCOUNT, { id: tunnel.id });
        return [yield* read(p, props, output), yield* read(p, props)] as const;
      }),
    );
    expect(Unowned.is(owned)).toBe(false);
    expect(owned).toMatchObject({ id: tunnel.id, name: 'k8s-admin' });
    expect(Unowned.is(probe)).toBe(true);
    expect(probe).toMatchObject({ id: tunnel.id, name: 'k8s-admin' });
    expect(tokenReads(fake)).toBe(0);
    expect(writes(fake)).toEqual([]);
  });

  test('adopting twice is idempotent: the second reconcile over the adopted row writes nothing', async () => {
    const fake = fakeTunnels();
    const tunnel = fake.seed({ name: 'k8s-admin', status: 'healthy' });
    const [first, second] = await run(fake, (p) =>
      Effect.gen(function* () {
        const adopted = yield* read(p, props);
        expect(Unowned.is(adopted)).toBe(true);
        const first = yield* reconcile(p, props, adopted);
        return [first, yield* reconcile(p, props, first)] as const;
      }),
    );
    expect(first).toEqual(second);
    expect(first.id).toBe(tunnel.id);
    expect(writes(fake)).toEqual([]);
    expect(tokenReads(fake)).toBe(0);
  });

  test('a rename is a PATCH on the same id', async () => {
    const fake = fakeTunnels();
    const [first, second] = await run(fake, (p) =>
      Effect.gen(function* () {
        const first = yield* reconcile(p, props);
        return [first, yield* reconcile(p, { name: 'k8s-admin-2' }, first)] as const;
      }),
    );
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('k8s-admin-2');
    expect(writes(fake)).toEqual(['POST', 'PATCH']);
    expect(fake.seen.find((s) => s.method === 'PATCH')?.body).toEqual({ name: 'k8s-admin-2' });
  });

  test('an unchanged tunnel costs no write', async () => {
    const fake = fakeTunnels();
    await run(fake, (p) => Effect.flatMap(reconcile(p, props), (out) => reconcile(p, props, out)));
    expect(writes(fake)).toEqual(['POST']);
  });

  test('a tunnel deleted out of band is created again', async () => {
    const fake = fakeTunnels();
    const [first, second] = await run(fake, (p) =>
      Effect.gen(function* () {
        const first = yield* reconcile(p, props);
        const tunnel = fake.tunnels.get(first.id);
        if (tunnel !== undefined) tunnel.deleted_at = '2026-10-09T02:00:00Z';
        return [first, yield* reconcile(p, props, first)] as const;
      }),
    );
    expect(second.id).not.toBe(first.id);
    expect(fake.live()).toHaveLength(1);
  });

  test('delete removes the tunnel by id, and deleting it again sends nothing', async () => {
    const fake = fakeTunnels();
    await run(fake, (p) =>
      Effect.gen(function* () {
        const output = yield* reconcile(p, props);
        yield* p.delete({ ...ids, ...extra, olds: props, output });
        yield* p.delete({ ...ids, ...extra, olds: props, output });
      }),
    );
    expect(fake.live()).toHaveLength(0);
    expect(writes(fake)).toEqual(['POST', 'DELETE']);
    expect(tokenReads(fake)).toBe(0);
  });

  test('diff reads the account from the provider environment', async () => {
    const fake = fakeTunnels();
    const plan = (p: Parameters<typeof diff>[0]) => diff(p, props, props, stored(FAKE_ACCOUNT));
    expect(await run(fake, plan)).toBeUndefined();
    expect(await run(fake, plan, '00000000000000000000000000000002')).toEqual({
      action: 'replace',
    });
    const renamed = await run(fake, (p) =>
      diff(p, { name: 'k8s-admin-2' }, props, stored(FAKE_ACCOUNT)),
    );
    expect(renamed).toEqual({ action: 'update' });
  });

  test('an invalid declaration fails the PLAN', async () => {
    const fake = fakeTunnels();
    const failure = await run(fake, (p) =>
      Effect.flip(diff(p, { name: 'k8s-admin ' }, props, stored(FAKE_ACCOUNT))),
    );
    expect(String(failure)).toContain('whitespace');
    expect(fake.seen).toHaveLength(0);
  });

  test('list is empty and nuke skips it: Alchemy Tunnel already enumerates these', async () => {
    const fake = fakeTunnels();
    fake.seed({ name: 'k8s-admin' });
    const [listed, nuke] = await run(fake, (p) =>
      Effect.map(p.list(), (rows) => [rows, p.nuke] as const),
    );
    expect(listed).toEqual([]);
    expect(nuke).toEqual({ skip: true });
    expect(fake.seen).toHaveLength(0);
  });
});
