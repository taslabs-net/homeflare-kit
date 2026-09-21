/**
 * MeshNode's removal policy, through Alchemy's real plan/apply (`engine` in mesh-node-harness.ts)
 * over the fake Cloudflare. The policy lives in the engine, not the provider, so the handler-level
 * tests beside this one cannot see it.
 *
 * ⛔ WHAT THESE PIN: `retain` is the default (a dropped declaration deletes nothing), a same-name
 *   `ha` change refuses and writes nothing until the deploy opts in with
 *   `RemovalPolicy.destroy()`, and the sentence's way back (drop the row, adopt) works while a
 *   plain revert does not. Deleting `defaultRemovalPolicy`, or turning `deleteFirst` off in
 *   mesh-node-form.ts, fails at least one test here.
 * ⛔ AND THE SENTENCES NEVER SEND AN OPERATOR THE WRONG WAY: a node holding a create-first
 *   replace's NEW name is not called the old node, and `adopt(true)` alone, which does nothing to
 *   a `replacing` row, is never offered as the way back from inside a replace.
 */
import { describe, expect, test } from 'bun:test';
import { adopt } from 'alchemy/AdoptPolicy';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeMesh } from './fake-mesh.ts';
import { engine, failureOf, writes } from './mesh-node-harness.ts';
import { MeshNode } from './mesh-node.ts';

/** The logical id every test declares; at the stack root it is also the state row's fqn. */
const DOOR = 'door';
const door = (ha: boolean, name = 'door-a') => MeshNode(DOOR, { name, ha });
const liveNodes = (fake: ReturnType<typeof fakeMesh>) =>
  fake.live().map((node) => ({ id: node.id, name: node.name, ha: node.ha }));

describe('MeshNode removal policy (the real engine)', () => {
  test('retain is the default: dropping the declaration leaves the node and sends no DELETE', async () => {
    const fake = fakeMesh();
    const stack = engine(fake);
    expect(failureOf(await stack.deploy(door(false)))).toBe('');
    expect(failureOf(await stack.deploy(Effect.void))).toBe('');
    expect(stack.status(DOOR)).toBeUndefined();
    expect(liveNodes(fake)).toHaveLength(1);
    expect(writes(fake)).toEqual(['POST']);
  });

  test('RemovalPolicy.destroy() still reaches the implemented delete', async () => {
    const fake = fakeMesh();
    const stack = engine(fake);
    await stack.deploy(door(false).pipe(RemovalPolicy.destroy()));
    expect(failureOf(await stack.deploy(Effect.void))).toBe('');
    expect(liveNodes(fake)).toHaveLength(0);
    expect(writes(fake)).toEqual(['POST', 'DELETE']);
  });

  test('an `ha` change under the default refuses, writes nothing, and names the opt-in', async () => {
    const fake = fakeMesh();
    const stack = engine(fake);
    await stack.deploy(door(false));
    const [before] = liveNodes(fake);
    const failure = failureOf(await stack.deploy(door(true)));
    expect(failure).toContain(`"door-a" already exists (${before?.id})`);
    expect(failure).toContain('RemovalPolicy.retain');
    expect(failure).toContain('.pipe(RemovalPolicy.destroy())');
    expect(failure).toContain('reverting `ha` is not enough');
    expect(liveNodes(fake)).toEqual([{ id: before?.id ?? '', name: 'door-a', ha: false }]);
    expect(writes(fake)).toEqual(['POST']);
  });

  test('opting in with RemovalPolicy.destroy() completes it delete-first, then retain is back', async () => {
    const fake = fakeMesh();
    const stack = engine(fake);
    await stack.deploy(door(false));
    await stack.deploy(door(true));
    const done = await stack.deploy(door(true).pipe(RemovalPolicy.destroy()));
    expect(failureOf(done)).toBe('');
    expect(writes(fake)).toEqual(['POST', 'DELETE', 'POST']);
    expect(liveNodes(fake)).toMatchObject([{ name: 'door-a', ha: true }]);
    // ★ The opt-in lasts one deploy: without it the row is re-committed as retain.
    await stack.deploy(door(true));
    await stack.deploy(Effect.void);
    expect(liveNodes(fake)).toHaveLength(1);
  });

  test('reverting `ha` does not undo a refused replace; dropping the row and adopting does', async () => {
    const fake = fakeMesh();
    const stack = engine(fake);
    await stack.deploy(door(false));
    const [original] = liveNodes(fake);
    await stack.deploy(door(true));
    expect(stack.status(DOOR)).toBe('replacing');
    expect(failureOf(await stack.deploy(door(false)))).toContain('already exists');

    stack.forget(DOOR);
    const back = await stack.deploy(door(false).pipe(adopt(true)));
    expect(failureOf(back)).toBe('');
    expect(stack.status(DOOR)).not.toBe('replacing');
    expect(liveNodes(fake)).toEqual([{ id: original?.id ?? '', name: 'door-a', ha: false }]);
    expect(writes(fake)).toEqual(['POST']);
  });

  test('`ha` and `name` together replace create-first, and the old node stays live', async () => {
    const fake = fakeMesh();
    const stack = engine(fake);
    await stack.deploy(door(false));
    expect(failureOf(await stack.deploy(door(true, 'door-b')))).toBe('');
    expect(liveNodes(fake).map((node) => [node.name, node.ha])).toEqual([
      ['door-a', false],
      ['door-b', true],
    ]);
    expect(writes(fake)).toEqual(['POST', 'POST']);
  });

  test('`ha` and `name` into a name another node holds: not called the old node, and nothing deletes it', async () => {
    const fake = fakeMesh();
    const stack = engine(fake);
    await stack.deploy(door(false));
    const other = fake.seed({ name: 'door-b', ha: false });
    const refused = failureOf(await stack.deploy(door(true, 'door-b')));
    expect(refused).toContain(`"door-b" already exists (${other.id})`);
    expect(refused).toContain('If this deploy changed `ha` and kept the name');
    expect(refused).toContain('Otherwise it is another node: do not delete it.');
    // ★ destroy() reaches only the old generation, never the name holder: refused again.
    const optedIn = door(true, 'door-b').pipe(RemovalPolicy.destroy());
    expect(failureOf(await stack.deploy(optedIn))).toContain('already exists');
    // ⚠️ adopt(true) alone does not act on the `replacing` row either.
    const adopted = door(true, 'door-b').pipe(adopt(true));
    expect(failureOf(await stack.deploy(adopted))).toContain('already exists');
    expect(liveNodes(fake).map((node) => node.name)).toEqual(['door-a', 'door-b']);
    expect(writes(fake)).toEqual(['POST']);
  });

  test('a lost-response retry inside an opted-in replace names state rm, which adopt(true) alone is not', async () => {
    let lose = false;
    const fake = fakeMesh({
      onCreate: (name) => {
        if (!lose) return undefined;
        lose = false;
        // What a retried POST meets: the node its first, lost-response attempt created.
        fake.seed({ name, ha: true });
        return fakeFailure(409, 1013, 'Tunnel with name already exists');
      },
    });
    const stack = engine(fake);
    await stack.deploy(door(false));
    lose = true;
    const raced = failureOf(await stack.deploy(door(true).pipe(RemovalPolicy.destroy())));
    expect(raced).toContain('appeared between');
    expect(raced).toContain("after a replace drop this resource's state row (alchemy state rm");
    expect(stack.status(DOOR)).toBe('replacing');
    expect(failureOf(await stack.deploy(door(true).pipe(adopt(true))))).toContain('already exists');

    stack.forget(DOOR);
    expect(failureOf(await stack.deploy(door(true).pipe(adopt(true))))).toBe('');
    expect(liveNodes(fake)).toMatchObject([{ name: 'door-a', ha: true }]);
    expect(writes(fake)).toEqual(['POST', 'DELETE', 'POST']);
  });
});
