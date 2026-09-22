/**
 * An adopted row whose provider's `diff` never looks at the live object (recheck.ts).
 *
 * 🔴 THE FALSE PASS THIS PINS (red-teamed 2026-09-21). Plan.ts hands an adopted row's diff
 *   `olds: news`, so a diff that compares recorded props with the declaration answers `noop`
 *   whatever the cloud holds. The verifier printed `ok` and exited 0 over a drift it had itself
 *   listed under `changed`, and the deploy then wrote it. The first test fails that way on the
 *   verifier without recheck.ts.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { Recorded, Thing, cloudOf, fakeEngine, writesOf } from './fake-engine.ts';
import { exitCodeOf } from './report.ts';

const recorded = (name: string, comment: string) => Recorded(name, { comment, name });

describe('an adopted row whose diff compares recorded props', () => {
  test('that drifted: asked again with the live value, it says update, and the row fails', async () => {
    const cloud = cloudOf({ drifted: 'old' });
    const engine = fakeEngine(cloud);
    const report = await engine.verify(recorded('drifted', 'new'));
    expect(report.rows).toEqual([
      expect.objectContaining({
        changed: ['comment'],
        diff: 'noop',
        ok: false,
        planned: 'adopted',
        recheck: 'update',
      }),
    ]);
    expect(report.rows[0]?.why).toContain('recorded props');
    expect(exitCodeOf(report)).toBe(1);
    expect(writesOf(cloud)).toEqual([]);

    // ★ And the verdict is the deploy's: the forced reconcile writes the drift the diff hid.
    expect(await engine.deploy(recorded('drifted', 'new'))).toEqual({ drifted: 'adopted' });
    expect(cloud.live.get('drifted')).toBe('new');
  });

  test('that matches: nothing differs, so it is not asked again and passes', async () => {
    const cloud = cloudOf({ same: 'x' });
    const report = await fakeEngine(cloud).verify(recorded('same', 'x'));
    expect(report.rows[0]).toMatchObject({ changed: [], diff: 'noop', ok: true });
    expect(report.rows[0]?.recheck).toBeUndefined();
    expect(cloud.calls.filter((call) => call.startsWith('diff'))).toEqual(['diff same']);
  });

  test('a diff that reads the live object is not asked again when it already said update', async () => {
    const cloud = cloudOf({ drifted: 'old' });
    const report = await fakeEngine(cloud).verify(
      Effect.all([Thing('drifted', { comment: 'new', name: 'drifted' })]),
    );
    expect(report.rows[0]).toMatchObject({ diff: 'update', ok: false });
    expect(report.rows[0]?.recheck).toBeUndefined();
  });
});
