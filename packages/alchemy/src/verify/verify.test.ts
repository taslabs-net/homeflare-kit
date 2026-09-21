/**
 * The verifier against Alchemy's own planner (fake-engine.ts): what it reports for each kind of row,
 * and that it never writes while the engine it watches would.
 *
 * ★ THE FIRST TEST IS THE MEASUREMENT THE TOOL EXISTS FOR. alchemy beta.79 prints `adopted` for a
 *   matching object and for a drifting one alike, and the deploy reconciles both. Pinned here so an
 *   Alchemy upgrade that stops forcing the update — or starts logging the diff — fails loudly and
 *   this tool can be re-thought rather than silently duplicated.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import {
  Blind,
  type Body,
  type Cloud,
  Thing,
  cloudOf,
  fakeEngine,
  writesOf,
} from './fake-engine.ts';
import { exitCodeOf } from './report.ts';

const one = (name: string, comment?: string) =>
  Thing(name, comment === undefined ? { name } : { comment, name });

const rowsBy = async (cloud: Cloud, body: Body, all = false) => {
  const report = await fakeEngine(cloud).verify(body, { all });
  return { byFqn: Object.fromEntries(report.rows.map((row) => [row.fqn, row])), report };
};

describe('what alchemy beta.79 does with an adoption', () => {
  test('prints adopted for a match and for a drift alike, and reconciles both', async () => {
    const cloud = cloudOf({ same: 'x', drifted: 'old' });
    const planned = await fakeEngine(cloud).deploy(
      Effect.all([one('same', 'x'), one('drifted', 'new')]),
    );
    expect(planned).toEqual({ drifted: 'adopted', same: 'adopted' });
    expect(writesOf(cloud).sort()).toEqual(['reconcile drifted', 'reconcile same']);
  });
});

describe('verifySession', () => {
  test('a matching adoption is a no-op, and verifying it writes nothing', async () => {
    const cloud = cloudOf({ same: 'x' });
    const { byFqn, report } = await rowsBy(cloud, one('same', 'x'));
    expect(byFqn['same']).toMatchObject({
      changed: [],
      diff: 'noop',
      ok: true,
      planned: 'adopted',
      read: 'found',
      stateRow: false,
      type: 'Test.Thing',
    });
    expect(exitCodeOf(report)).toBe(0);
    expect(writesOf(cloud)).toEqual([]);
    expect(cloud.calls).toEqual(['read same', 'diff same']);
  });

  test('a drifting adoption says update and names the field, though the engine says adopted', async () => {
    const cloud = cloudOf({ drifted: 'old' });
    const { byFqn, report } = await rowsBy(cloud, one('drifted', 'new'));
    expect(byFqn['drifted']).toMatchObject({
      changed: ['comment'],
      diff: 'update',
      ok: false,
      planned: 'adopted',
    });
    expect(byFqn['drifted']?.why).toContain('the deploy writes');
    expect(exitCodeOf(report)).toBe(1);
    expect(writesOf(cloud)).toEqual([]);
  });

  test('an object the read cannot find is a create, not an adoption', async () => {
    const cloud = cloudOf();
    const { byFqn } = await rowsBy(cloud, one('fresh'));
    expect(byFqn['fresh']).toMatchObject({ diff: 'not-run', ok: false, planned: 'create' });
    expect(byFqn['fresh']?.read).toBe('absent');
    expect(byFqn['fresh']?.why).toContain('CREATES');
  });

  test('an unowned match is a no-op with a note that the deploy needs --adopt', async () => {
    const cloud = cloudOf({ theirs: 'x' });
    cloud.unowned.add('theirs');
    const { byFqn } = await rowsBy(cloud, one('theirs', 'x'));
    expect(byFqn['theirs']).toMatchObject({ diff: 'noop', ok: true, read: 'unowned' });
    expect(byFqn['theirs']?.why).toContain('--adopt');
  });

  test('a provider with no diff cannot prove an adoption', async () => {
    const cloud = cloudOf({ blind: 'x' });
    const { byFqn } = await rowsBy(cloud, Blind('blind', { comment: 'x', name: 'blind' }));
    expect(byFqn['blind']).toMatchObject({ diff: 'none', ok: false, planned: 'adopted' });
  });

  test('rows with state are left out by default and read afresh with all', async () => {
    const cloud = cloudOf();
    const engine = fakeEngine(cloud);
    await engine.deploy(one('kept', 'x'));
    cloud.live.set('new', 'y');
    cloud.calls.length = 0;
    const body = Effect.all([one('kept', 'x'), one('new', 'y')]);

    const scoped = await engine.verify(body);
    expect(scoped.rows.map((row) => row.fqn)).toEqual(['new']);
    expect(scoped.declared).toBe(2);

    const all = await engine.verify(body, { all: true });
    const kept = all.rows.find((row) => row.fqn === 'kept');
    expect(kept).toMatchObject({ diff: 'noop', ok: true, planned: 'noop', read: 'found' });
    expect(kept?.stateRow).toBe(true);
    expect(writesOf(cloud)).toEqual([]);
  });

  test('with all, a row no longer declared is a pending delete', async () => {
    const cloud = cloudOf();
    const engine = fakeEngine(cloud);
    await engine.deploy(one('gone', 'x'));
    const report = await engine.verify(Effect.void, { all: true });
    expect(report.rows).toEqual([expect.objectContaining({ fqn: 'gone', ok: false })]);
    expect(report.rows[0]?.planned).toBe('delete');
    expect(cloud.live.get('gone')).toBe('x');
  });
});
