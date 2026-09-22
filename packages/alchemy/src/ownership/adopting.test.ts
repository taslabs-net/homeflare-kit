/**
 * `adopting` answer by answer, against a store fixture: which rows make a call with attributes an
 * adoption. `Proxmox.Lxc` pins the same answers end to end through the engine
 * (proxmox/lxc-strict-adopt.test.ts, proxmox/lxc-ownership.test.ts).
 */
import { describe, expect, test } from 'bun:test';
import type { ResourceState } from 'alchemy/State/ResourceState';
import * as Effect from 'effect/Effect';
import { adopting } from './adopting.ts';
import { row, withStore } from './store-fixture.ts';

const matches = () => Effect.succeed(true);
const differs = () => Effect.succeed(false);
const held = { name: 'a' };
const owner = (instanceId: string, output: unknown = held) => ({ fqn: 'A', instanceId, output });
const creating = { fqn: 'A', instanceId: 'probe', output: undefined };

const recorded = (status: string, extra: Record<string, unknown> = {}): ResourceState =>
  ({ ...row('A', 'mine'), attr: held, status, ...extra }) as unknown as ResourceState;

describe('adopting', () => {
  test("the probe's instance, which no row holds, is an adoption", async () => {
    expect(await withStore({ A: recorded('created') }, adopting(owner('probe'), matches))).toBe(
      true,
    );
  });

  test("Apply's adoption row, and an interrupted one, stay adoptions until they commit", async () => {
    const rows = { A: recorded('updating', { adopting: true }) };
    expect(await withStore(rows, adopting(owner('mine'), matches))).toBe(true);
  });

  test('a row with attributes and no flag is state vouching for the object', async () => {
    for (const status of ['created', 'updated', 'updating']) {
      expect(await withStore({ A: recorded(status) }, adopting(owner('mine'), differs))).toBe(
        false,
      );
    }
  });

  test('a recovered create is ours only when its whole row matches live', async () => {
    const rows = { A: row('A', 'mine') };
    expect(await withStore(rows, adopting(owner('mine'), matches))).toBe(false);
    expect(await withStore(rows, adopting(owner('mine'), differs))).toBe(true);
    const holed = { A: row('A', 'mine', undefined, {}) };
    expect(await withStore(holed, adopting(owner('mine'), matches))).toBe(true);
  });

  test('`settled` is asked with the props of the row that recorded the create', async () => {
    const seen: unknown[] = [];
    const spy = (props: unknown) => Effect.sync(() => (seen.push(props), true));
    await withStore({ A: row('A', 'mine') }, adopting(owner('mine'), spy));
    expect(seen).toEqual([{ name: 'a' }]);
  });

  test('a create (no attributes held) is never one; reconcile has its own rule', async () => {
    expect(await withStore({}, adopting(creating, differs))).toBe(false);
  });

  test('outside a stack every call with attributes is an adoption — the strict answer', async () => {
    expect(await Effect.runPromise(adopting(owner('mine'), matches))).toBe(true);
  });
});
