/**
 * MeshNodeProvider against a fake Cloudflare (fake-mesh.ts), its handlers called the way the
 * engine calls them.
 *
 * ⛔ THE ASSERTION THAT MATTERS MOST: no lifecycle handler ever requests `/token`, and nothing
 *   the provider returns contains the node token — even though the fake's create response carries
 *   one, as Cloudflare's HA page says the real one does.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import type { StackServices } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import {
  FAKE_ACCOUNT,
  FAKE_API_TOKEN,
  type FakeMesh,
  fakeMesh,
  fakeProviderLayer,
} from './fake-mesh.ts';
import { MeshNode, MeshNodeProvider } from './mesh-node.ts';
import type { MeshNodeAttributes, MeshNodeProps } from './mesh-node-form.ts';
import { providers } from './providers.ts';

// ⛔ Compile-time: a stack's `providers` must be `Layer<…, never, StackServices>`. Adding MeshNode
//   first leaked Alchemy's auth errors into the error channel; `bun run types` now catches that.
type Built = Layer.Success<ReturnType<typeof providers>>;
const _stackShaped: Layer.Layer<Built, never, StackServices> = providers();
void _stackShaped;

const ids = { fqn: 'stack/door', id: 'door', instanceId: 'i-1' };
const extra = { bindings: [] as never, session: undefined as never };

type P = Effect.Success<typeof MeshNode.Provider>;
const handler = <F>(name: string, fn: F | undefined): F => {
  if (fn === undefined) throw new Error(`provider has no ${name} handler`);
  return fn;
};

const run = <A, E>(fake: FakeMesh, use: (p: P) => Effect.Effect<A, E>, accountId?: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* use(yield* MeshNode.Provider);
    }).pipe(
      Effect.provide(
        MeshNodeProvider().pipe(Layer.provideMerge(fakeProviderLayer(fake, accountId))),
      ),
    ),
  );

const reconcile = (p: P, news: MeshNodeProps, output?: MeshNodeAttributes) =>
  p.reconcile({ ...ids, ...extra, news, olds: undefined, output });
const read = (p: P, olds: MeshNodeProps, output?: MeshNodeAttributes) =>
  handler('read', p.read)({ ...ids, olds, output });
const tokenReads = (fake: FakeMesh) => fake.seen.filter((s) => s.path.endsWith('/token')).length;

describe('MeshNodeProvider', () => {
  test('create sends ha, and the attributes carry no token', async () => {
    const fake = fakeMesh();
    const out = await run(fake, (p) => reconcile(p, { name: 'door-a', ha: true }));
    const post = fake.seen.find((s) => s.method === 'POST');
    expect(post?.body).toEqual({ name: 'door-a', ha: true });
    expect(out).toMatchObject({
      name: 'door-a',
      ha: true,
      accountId: FAKE_ACCOUNT,
      status: 'inactive',
    });
    expect(Object.keys(out).sort()).toEqual(['accountId', 'ha', 'id', 'name', 'status']);
    expect(JSON.stringify(out)).not.toContain('fake-node-token');
    expect(tokenReads(fake)).toBe(0);
    expect(new Set(fake.auth)).toEqual(new Set([`Bearer ${FAKE_API_TOKEN}`]));
  });

  test('read with state refreshes by id; without state it adopts by exact name, Unowned', async () => {
    const fake = fakeMesh();
    fake.seed({ name: 'door-a-old' });
    fake.seed({ name: 'door-a-older' });
    const node = fake.seed({ name: 'door-a', status: 'healthy' });
    const props = { name: 'door-a', ha: false };
    const [owned, probe] = await run(fake, (p) =>
      Effect.gen(function* () {
        const output = {
          id: node.id,
          accountId: FAKE_ACCOUNT,
          name: 'door-a',
          status: undefined,
          ha: false,
        };
        return [yield* read(p, props, output), yield* read(p, props)] as const;
      }),
    );
    expect(Unowned.is(owned)).toBe(false);
    expect(owned).toMatchObject({ id: node.id, status: 'healthy' });
    expect(Unowned.is(probe)).toBe(true);
    expect(probe).toMatchObject({ id: node.id, name: 'door-a', ha: false });
    expect(tokenReads(fake)).toBe(0);
  });

  test('a prefix-only match or a deleted node is not adopted', async () => {
    const fake = fakeMesh();
    fake.seed({ name: 'door-a-2' });
    fake.seed({ name: 'door-a', deleted_at: '2026-09-20T00:00:00Z' });
    const probe = await run(fake, (p) => read(p, { name: 'door-a', ha: false }));
    expect(probe).toBeUndefined();
  });

  test('a rename is a PATCH on the same id', async () => {
    const fake = fakeMesh();
    const [first, second] = await run(fake, (p) =>
      Effect.gen(function* () {
        const first = yield* reconcile(p, { name: 'door-a', ha: false });
        return [first, yield* reconcile(p, { name: 'door-b', ha: false }, first)] as const;
      }),
    );
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('door-b');
    expect(fake.seen.filter((s) => s.method === 'POST')).toHaveLength(1);
    expect(fake.seen.find((s) => s.method === 'PATCH')?.body).toEqual({ name: 'door-b' });
  });

  test('an unchanged node costs no write', async () => {
    const fake = fakeMesh();
    await run(fake, (p) =>
      Effect.flatMap(reconcile(p, { name: 'door-a', ha: false }), (out) =>
        reconcile(p, { name: 'door-a', ha: false }, out),
      ),
    );
    expect(fake.seen.filter((s) => s.method !== 'GET').map((s) => s.method)).toEqual(['POST']);
  });

  test('reconcile refuses an ha change that reached it as an update', async () => {
    const fake = fakeMesh();
    const failure = await run(fake, (p) =>
      Effect.flip(
        Effect.flatMap(reconcile(p, { name: 'door-a', ha: false }), (out) =>
          reconcile(p, { name: 'door-a', ha: true }, out),
        ),
      ),
    );
    expect(String(failure)).toContain('create-only');
  });

  test('create never converges on a node it did not create (a retained old generation)', async () => {
    const fake = fakeMesh();
    fake.seed({ name: 'door-a', ha: false });
    const failure = await run(fake, (p) => Effect.flip(reconcile(p, { name: 'door-a', ha: true })));
    expect(String(failure)).toContain('already exists');
    expect(fake.seen.some((s) => s.method === 'POST')).toBe(false);
  });

  test('a node deleted out of band is created again', async () => {
    const fake = fakeMesh();
    const [first, second] = await run(fake, (p) =>
      Effect.gen(function* () {
        const first = yield* reconcile(p, { name: 'door-a', ha: false });
        const node = fake.nodes.get(first.id);
        if (node !== undefined) node.deleted_at = '2026-09-21T02:00:00Z';
        return [first, yield* reconcile(p, { name: 'door-a', ha: false }, first)] as const;
      }),
    );
    expect(second.id).not.toBe(first.id);
    expect(fake.live()).toHaveLength(1);
  });

  test('delete removes the node, and deleting it again succeeds', async () => {
    const fake = fakeMesh();
    await run(fake, (p) =>
      Effect.gen(function* () {
        const output = yield* reconcile(p, { name: 'door-a', ha: false });
        const olds = { name: 'door-a', ha: false };
        yield* p.delete({ ...ids, ...extra, olds, output });
        yield* p.delete({ ...ids, ...extra, olds, output });
      }),
    );
    expect(fake.live()).toHaveLength(0);
    expect(fake.seen.filter((s) => s.method === 'DELETE')).toHaveLength(2);
  });

  test('diff reads the account from the provider environment', async () => {
    const fake = fakeMesh();
    const output = {
      id: 'x',
      accountId: FAKE_ACCOUNT,
      name: 'door-a',
      status: undefined,
      ha: false,
    };
    const diff = (p: P) =>
      handler(
        'diff',
        p.diff,
      )({
        ...ids,
        news: { name: 'door-a', ha: false },
        olds: { name: 'door-a', ha: false },
        newBindings: [] as never,
        oldBindings: [] as never,
        output,
      });
    expect(await run(fake, diff)).toBeUndefined();
    expect(await run(fake, diff, '00000000000000000000000000000002')).toEqual({
      action: 'replace',
    });
  });

  test('an invalid declaration fails the PLAN, before a delete-first replace tears anything down', async () => {
    const fake = fakeMesh();
    const output = {
      id: 'x',
      accountId: FAKE_ACCOUNT,
      name: 'door-a',
      status: undefined,
      ha: false,
    };
    const failure = await run(fake, (p) =>
      Effect.flip(
        handler(
          'diff',
          p.diff,
        )({
          ...ids,
          news: { name: 'door-a ', ha: true },
          olds: { name: 'door-a', ha: false },
          newBindings: [] as never,
          oldBindings: [] as never,
          output,
        }),
      ),
    );
    expect(String(failure)).toContain('whitespace');
    expect(fake.seen).toHaveLength(0);
  });

  test('list is empty and nuke skips it: Alchemy WarpConnector already enumerates these', async () => {
    const fake = fakeMesh();
    fake.seed({ name: 'door-a' });
    const [listed, nuke] = await run(fake, (p) =>
      Effect.map(p.list(), (rows) => [rows, p.nuke] as const),
    );
    expect(listed).toEqual([]);
    expect(nuke).toEqual({ skip: true });
    expect(fake.seen).toHaveLength(0);
  });
});
