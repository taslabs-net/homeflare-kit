/**
 * A changed mount path: refused without `remountFrom`, moved with it — for secrets engines and for
 * auth methods. The fake keeps a live mount table, so the move is judged by what it leaves behind.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reconcileAuthMethod } from './auth-method-reconcile.ts';
import { type Reply, type Seen, run, withFake } from './fake-bao.ts';
import { planMove } from './mount-move.ts';
import { reconcileMount } from './mount-reconcile.ts';

describe('planMove', () => {
  it('stays when the path is unchanged, whatever remountFrom says', () => {
    assert.deepEqual(planMove('Bao.Mount', 'kv', 'kv/', undefined), { kind: 'stay' });
    assert.deepEqual(planMove('Bao.Mount', 'kv', 'kv', 'old'), { kind: 'stay' });
    assert.deepEqual(planMove('Bao.Mount', undefined, 'kv', undefined), { kind: 'stay' });
  });

  it('refuses a changed path with no remountFrom, and names the fix', () => {
    const move = planMove('Bao.Mount', 'kv', 'kv2', undefined);
    assert.equal(move.kind, 'refuse');
    assert.match(move.kind === 'refuse' ? move.message : '', /EMPTY mount.*remountFrom: 'kv'/s);
  });

  it('refuses a remountFrom that is not the path in state', () => {
    assert.equal(planMove('Bao.Mount', 'kv', 'kv2', 'other').kind, 'refuse');
  });

  it('moves when remountFrom names the stated path, or on a first reconcile', () => {
    assert.deepEqual(planMove('Bao.Mount', 'kv/', 'kv2', 'kv/'), { from: 'kv', kind: 'move' });
    assert.deepEqual(planMove('Bao.Mount', undefined, 'kv2', 'kv'), { from: 'kv', kind: 'move' });
  });
});

/** A fake with a live table under `prefix` (`sys/mounts` or `sys/auth`) that sys/remount edits. */
const liveTable = (prefix: string, initial: Record<string, string>) => {
  const table = new Map(Object.entries(initial).map(([path, type]) => [`${path}/`, type]));
  const entry = (type: string) => ({ config: { default_lease_ttl: 0, max_lease_ttl: 0 }, type });
  const answer = (seen: Seen): Reply => {
    const path = seen.path.replace(/^\/v1\//, '');
    if (path === 'sys/remount' && seen.method === 'POST') {
      const { from, to } = JSON.parse(seen.body) as { from: string; to: string };
      const key = `${from.replace(/^auth\//, '')}/`;
      const type = table.get(key);
      if (type === undefined) return { json: { errors: ['no matching mount'] }, status: 400 };
      table.delete(key);
      table.set(`${to.replace(/^auth\//, '')}/`, type);
      return { json: { data: { migration_id: 'm-1' } }, status: 200 };
    }
    if (path.startsWith('sys/remount/status/')) {
      return { json: { data: { migration_info: { status: 'success' } } }, status: 200 };
    }
    if (path === prefix) {
      return { json: { data: Object.fromEntries(table) }, status: 200 };
    }
    const mount = path.slice(prefix.length + 1).replace(/\/tune$/, '');
    if (seen.method === 'POST') {
      if (!path.endsWith('/tune')) table.set(`${mount}/`, 'enabled-by-test');
      return { status: 204 };
    }
    const type = table.get(`${mount}/`);
    return type === undefined
      ? { json: { errors: [`No secret engine mount at ${mount}/`] }, status: 400 }
      : { json: { data: entry(type) }, status: 200 };
  };
  return { answer, table };
};

const posts = (seen: Seen[]) =>
  seen.filter((each) => each.method === 'POST').map((each) => each.path);

describe('reconcileMount', () => {
  it('moves kv to its new path with sys/remount, and enables nothing', async () => {
    const live = liveTable('sys/mounts', { kv: 'kv' });
    await withFake(live.answer, async (bao) => {
      const props = { path: 'kv-moved', remountFrom: 'kv', type: 'kv' };
      const attributes = await run({ BAO_ADDR: bao.address }, reconcileMount(props, 'kv'));
      assert.equal(attributes.path, 'kv-moved');
      assert.deepEqual(posts(bao.seen), ['/v1/sys/remount']);
      assert.deepEqual([...live.table.keys()], ['kv-moved/']);
    });
  });

  it('refuses a changed path with no remountFrom before any write', async () => {
    const live = liveTable('sys/mounts', { kv: 'kv' });
    await withFake(live.answer, async (bao) => {
      await assert.rejects(
        run({ BAO_ADDR: bao.address }, reconcileMount({ path: 'kv-moved', type: 'kv' }, 'kv')),
        /EMPTY mount/,
      );
      assert.deepEqual(posts(bao.seen), []);
    });
  });

  it('converges when the move already happened (an interrupted apply re-running)', async () => {
    const live = liveTable('sys/mounts', { 'kv-moved': 'kv' });
    await withFake(live.answer, async (bao) => {
      const props = { path: 'kv-moved', remountFrom: 'kv', type: 'kv' };
      await run({ BAO_ADDR: bao.address }, reconcileMount(props, 'kv'));
      assert.deepEqual(posts(bao.seen), []);
    });
  });

  it('refuses when neither path exists, rather than enabling an empty mount', async () => {
    const live = liveTable('sys/mounts', {});
    await withFake(live.answer, async (bao) => {
      const props = { path: 'kv-moved', remountFrom: 'kv', type: 'kv' };
      await assert.rejects(
        run({ BAO_ADDR: bao.address }, reconcileMount(props, undefined)),
        /empty mount where data was expected/,
      );
      assert.deepEqual(posts(bao.seen), []);
    });
  });

  it('refuses when both paths exist, or the source is another type', async () => {
    const both = liveTable('sys/mounts', { kv: 'kv', 'kv-moved': 'kv' });
    await withFake(both.answer, async (bao) => {
      const props = { path: 'kv-moved', remountFrom: 'kv', type: 'kv' };
      await assert.rejects(run({ BAO_ADDR: bao.address }, reconcileMount(props, 'kv')), /both/);
    });
    const typed = liveTable('sys/mounts', { kv: 'pki' });
    await withFake(typed.answer, async (bao) => {
      const props = { path: 'kv-moved', remountFrom: 'kv', type: 'kv' };
      await assert.rejects(run({ BAO_ADDR: bao.address }, reconcileMount(props, 'kv')), /type/);
    });
  });
});

describe('reconcileAuthMethod', () => {
  it('moves an auth method through sys/remount with the auth/ prefix', async () => {
    const live = liveTable('sys/auth', { jwt: 'jwt' });
    await withFake(live.answer, async (bao) => {
      const props = { path: 'jwt-humans', remountFrom: 'jwt', type: 'jwt' };
      await run({ BAO_ADDR: bao.address }, reconcileAuthMethod(props, 'jwt'));
      const start = bao.seen.find((seen) => seen.path === '/v1/sys/remount');
      assert.equal(start?.body, JSON.stringify({ from: 'auth/jwt', to: 'auth/jwt-humans' }));
      assert.deepEqual([...live.table.keys()], ['jwt-humans/']);
    });
  });

  it('refuses a changed auth path with no remountFrom', async () => {
    const live = liveTable('sys/auth', { jwt: 'jwt' });
    await withFake(live.answer, async (bao) => {
      await assert.rejects(
        run({ BAO_ADDR: bao.address }, reconcileAuthMethod({ path: 'jwt2', type: 'jwt' }, 'jwt')),
        /Bao\.AuthMethod: path changed/,
      );
    });
  });
});
