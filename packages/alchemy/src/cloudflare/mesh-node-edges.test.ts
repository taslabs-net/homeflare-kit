/**
 * MeshNodeProvider's refusals and recoveries — the cases a mutation of each guard must break.
 *
 * ★ Every test here was written against a guard that a mutation pass (2026-09-21) could delete
 *   without any other test noticing: the two-match refusal, the 404 on a stored id, the stored
 *   account in `read`, the rename collision, the `stables` list and the 1013-after-lookup race.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import { FAKE_ACCOUNT, fakeFailure, fakeMesh } from './fake-mesh.ts';
import { read, reconcile, run, stored } from './mesh-node-harness.ts';

const OTHER_ACCOUNT = '00000000000000000000000000000002';
const UNKNOWN_ID = '00000000-0000-4000-8000-00000000ffff';

describe('MeshNodeProvider edges', () => {
  test('lookups filter by name and live-only on the wire', async () => {
    const fake = fakeMesh();
    fake.seed({ name: 'door-a', deleted_at: '2026-09-20T00:00:00Z' });
    await run(fake, (p) => read(p, { name: 'door-a', ha: false }));
    const list = fake.seen.find((s) => s.method === 'GET');
    expect(list?.path).toContain('name=door-a');
    expect(list?.path).toContain('is_deleted=false');
  });

  test('two live nodes with the declared name are refused, both named', async () => {
    const fake = fakeMesh();
    const a = fake.seed({ name: 'door-a' });
    const b = fake.seed({ name: 'door-a' });
    const failure = await run(fake, (p) => Effect.flip(read(p, { name: 'door-a', ha: false })));
    expect(failure.message).toContain(a.id);
    expect(failure.message).toContain(b.id);
  });

  test('a stored id the API no longer knows (404): read falls back to the name, reconcile creates', async () => {
    const fake = fakeMesh();
    const node = fake.seed({ name: 'door-a' });
    const gone = stored(FAKE_ACCOUNT, { id: UNKNOWN_ID, name: 'door-b' });
    const probe = await run(fake, (p) => read(p, { name: 'door-a', ha: false }, gone));
    expect(Unowned.is(probe)).toBe(true);
    expect(probe).toMatchObject({ id: node.id });

    const fresh = fakeMesh();
    const created = await run(fresh, (p) => reconcile(p, { name: 'door-b', ha: true }, gone));
    expect(created.id).not.toBe(UNKNOWN_ID);
    expect(fresh.seen.find((s) => s.method === 'POST')?.body).toEqual({ name: 'door-b', ha: true });
  });

  test('read refreshes in the account the node was written to, not the current environment', async () => {
    const fake = fakeMesh();
    const node = fake.seed({ name: 'door-a', status: 'healthy' });
    const output = stored(FAKE_ACCOUNT, { id: node.id });
    // ⚠️ The fake throws on any other account, so reading in OTHER_ACCOUNT fails this test.
    const fresh = await run(
      fake,
      (p) => read(p, { name: 'door-a', ha: false }, output),
      OTHER_ACCOUNT,
    );
    expect(fresh).toMatchObject({ id: node.id, accountId: FAKE_ACCOUNT, status: 'healthy' });
  });

  test('a rename onto a taken name fails with a sentence and changes nothing', async () => {
    const fake = fakeMesh();
    fake.seed({ name: 'door-b' });
    const node = fake.seed({ name: 'door-a' });
    const output = stored(FAKE_ACCOUNT, { id: node.id });
    const failure = await run(fake, (p) =>
      Effect.flip(reconcile(p, { name: 'door-b', ha: false }, output)),
    );
    expect(failure.message).toContain('"door-b" already exists');
    expect(fake.nodes.get(node.id)?.name).toBe('door-a');
  });

  test('only id, accountId and ha are stable across an update (a rename changes name)', async () => {
    const fake = fakeMesh();
    const stables = await run(fake, (p) => Effect.succeed(p.stables));
    expect(stables).toEqual(['id', 'accountId', 'ha']);
  });

  test('a 1013 after a clean lookup names the node that appeared, and does not adopt it', async () => {
    let appeared = '';
    const fake = fakeMesh({
      onCreate: (name) => {
        // What a retried POST meets: the node its first, lost-response attempt created.
        appeared = fake.seed({ name, ha: true }).id;
      },
    });
    const failure = await run(fake, (p) => Effect.flip(reconcile(p, { name: 'door-a', ha: true })));
    expect(failure.message).toContain(appeared);
    expect(failure.message).toContain('adopt(true)');
  });

  test('a 1013 with no live Mesh node of that name blames another tunnel type', async () => {
    const fake = fakeMesh({
      onCreate: () => fakeFailure(409, 1013, 'Tunnel with name already exists'),
    });
    const failure = await run(fake, (p) =>
      Effect.flip(reconcile(p, { name: 'door-a', ha: false })),
    );
    expect(failure.message).toContain('another tunnel type');
  });
});
