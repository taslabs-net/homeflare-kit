/**
 * `normalizeModel`/`modelTitle`/`declaredContentMatches` in isolation — no SDK, no fake, no
 * Effect. Proves the volatile fields (`id`, `version`, `iteration`) are stripped and `uid` is
 * forced to the canonical value regardless of where — or whether — the source model carried one,
 * and that `declaredContentMatches` tolerates Grafana's own schema-migration auto-decoration
 * without hiding genuine content drift. All of which is what makes a pasted "Export as JSON" and
 * a freshly-read live model compare equal in dashboard.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { declaredContentMatches, modelTitle, normalizeModel } from './dashboard-model.ts';

describe('normalizeModel', () => {
  test('strips id, version and iteration', () => {
    const model = { id: 42, iteration: 1700000000, title: 'Fleet', version: 7 };
    expect(normalizeModel(model, 'fleet')).toEqual({ title: 'Fleet', uid: 'fleet' });
  });

  test('forces uid to the canonical value, overwriting a stale embedded one', () => {
    const exported = { title: 'Fleet', uid: 'some-old-uid-from-an-export' };
    expect(normalizeModel(exported, 'fleet')).toEqual({ title: 'Fleet', uid: 'fleet' });
  });

  test('injects uid when the source model has none at all — a never-saved dashboard', () => {
    const neverSaved = { title: 'Fleet' };
    expect(normalizeModel(neverSaved, 'fleet')).toEqual({ title: 'Fleet', uid: 'fleet' });
  });

  test('a declared model and a live model that only disagree on volatile fields normalize equal', () => {
    const declared = { panels: [{ id: 1, title: 'CPU' }], title: 'Fleet' };
    const live = {
      id: 42,
      iteration: 1700000000,
      panels: [{ id: 1, title: 'CPU' }],
      title: 'Fleet',
      uid: 'fleet',
      version: 9,
    };
    expect(normalizeModel(declared, 'fleet')).toEqual(normalizeModel(live, 'fleet'));
  });

  test('preserves array order — panels and targets are position-significant, not a set', () => {
    const model = { panels: [{ title: 'B' }, { title: 'A' }] };
    expect(normalizeModel(model, 'x').panels).toEqual([{ title: 'B' }, { title: 'A' }]);
  });

  test('leaves an unrelated field genuinely different, so a real content change still shows', () => {
    const declared = { title: 'Fleet v2' };
    const live = { title: 'Fleet', uid: 'fleet' };
    expect(normalizeModel(declared, 'fleet')).not.toEqual(normalizeModel(live, 'fleet'));
  });
});

describe('modelTitle', () => {
  test('reads the model title', () => {
    expect(modelTitle({ title: 'Fleet' })).toBe('Fleet');
  });

  test('answers empty for a model with no title', () => {
    expect(modelTitle({})).toBe('');
  });
});

describe('declaredContentMatches', () => {
  // ⛔ THE REGRESSION THIS FUNCTION EXISTS TO FIX — found by an adversarial review of this PR.
  //   Grafana's own dashboard-save schema migration decorates a panel/target whose `datasource`
  //   is absent with an explicit `{type, uid}` reference. Before this function existed, a
  //   declared panel that never set `datasource` disagreed with what it read back FOREVER.
  test('tolerates Grafana auto-decorating a panel/target with a datasource it never declared', () => {
    const declared = {
      panels: [{ targets: [{ refId: 'A' }], title: 'CPU' }],
      title: 'Fleet',
    };
    const live = {
      panels: [
        {
          datasource: { type: 'postgres', uid: 'teslamate' },
          targets: [{ datasource: { type: 'postgres', uid: 'teslamate' }, refId: 'A' }],
          title: 'CPU',
        },
      ],
      title: 'Fleet',
    };
    expect(declaredContentMatches(declared, live)).toBe(true);
  });

  test('still catches a genuine change to a field the declaration DOES mention', () => {
    const declared = { panels: [{ title: 'CPU' }] };
    const live = { panels: [{ datasource: { uid: 'teslamate' }, title: 'Memory' }] };
    expect(declaredContentMatches(declared, live)).toBe(false);
  });

  test('still fails when live is missing a field the declaration mentions', () => {
    expect(declaredContentMatches({ title: 'Fleet' }, {})).toBe(false);
  });

  test('still fails on an array length mismatch — panels are not padded away', () => {
    const declared = { panels: [{ title: 'A' }, { title: 'B' }] };
    const live = { panels: [{ title: 'A' }] };
    expect(declaredContentMatches(declared, live)).toBe(false);
  });

  test('ignores an extra top-level field live carries that the declaration never mentioned', () => {
    expect(declaredContentMatches({ title: 'Fleet' }, { schemaVersion: 39, title: 'Fleet' })).toBe(
      true,
    );
  });

  test('null (or undefined) on a declared leaf never mismatches, mirroring stripNullish', () => {
    expect(declaredContentMatches({ description: null }, { description: 'set live' })).toBe(true);
  });
});
