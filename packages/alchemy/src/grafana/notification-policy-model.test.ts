/**
 * `normalizeRoute`/`flattenRoutes` in isolation — no SDK, no fake, no Effect. Mirrors
 * `alert-rule-group-model.test.ts`. Proves `provenance` is stripped recursively, that
 * `flattenRoutes` walks the tree depth-first with dotted-index paths, and — the fix an adversarial
 * review of this PR made necessary — that its `key` is ancestry-scoped: shared by siblings with
 * identical own-fields (so a multiset count, not set membership, is what distinguishes them),
 * distinct across different parents, and unaffected by sibling reordering.
 */
import { describe, expect, test } from 'bun:test';
import { flattenRoutes, normalizeRoute } from './notification-policy-model.ts';

describe('normalizeRoute', () => {
  test('strips provenance at the root', () => {
    expect(normalizeRoute({ provenance: 'api', receiver: 'default' })).toEqual({
      receiver: 'default',
    });
  });

  test('strips provenance recursively, at every nested route', () => {
    const tree = {
      provenance: 'api',
      receiver: 'default',
      routes: [
        {
          provenance: 'api',
          receiver: 'pagerduty',
          routes: [{ provenance: 'api', receiver: 'slack' }],
        },
      ],
    };
    expect(normalizeRoute(tree)).toEqual({
      receiver: 'default',
      routes: [{ receiver: 'pagerduty', routes: [{ receiver: 'slack' }] }],
    });
  });

  test('a declared tree and a live tree that only disagree on provenance normalize equal', () => {
    const declared = { receiver: 'default', routes: [{ receiver: 'pagerduty' }] };
    const live = {
      provenance: 'api',
      receiver: 'default',
      routes: [{ provenance: 'api', receiver: 'pagerduty' }],
    };
    expect(normalizeRoute(declared)).toEqual(normalizeRoute(live));
  });

  test('leaves a real content change genuinely different', () => {
    expect(normalizeRoute({ receiver: 'default' })).not.toEqual(
      normalizeRoute({ receiver: 'other' }),
    );
  });
});

describe('flattenRoutes', () => {
  test('walks the tree depth-first with dotted-index paths, root included', () => {
    const tree = {
      receiver: 'default',
      routes: [{ receiver: 'pagerduty' }, { receiver: 'slack', routes: [{ receiver: 'nested' }] }],
    };
    const flat = flattenRoutes(tree);
    expect(flat.map((r) => r.path)).toEqual(['root', 'root.0', 'root.1', 'root.1.0']);
    expect(flat.map((r) => r.receiver)).toEqual(['default', 'pagerduty', 'slack', 'nested']);
  });

  test("a route with no receiver of its own reports '(inherited)'", () => {
    expect(flattenRoutes({ matchers: ['x'] })[0]?.receiver).toBe('(inherited)');
  });

  test("each entry's key excludes its own routes children — they are separate entries", () => {
    const tree = { receiver: 'default', routes: [{ receiver: 'child' }] };
    const [root] = flattenRoutes(tree);
    expect(root?.key).not.toContain('child');
  });

  test('two siblings with identical own-fields under the SAME parent share one key', () => {
    const tree = { receiver: 'default', routes: [{ receiver: 'slack' }, { receiver: 'slack' }] };
    const [, first, second] = flattenRoutes(tree);
    expect(first?.key).toBe(second?.key);
    expect(first?.path).not.toBe(second?.path);
  });

  test('an identical route under a DIFFERENT parent has a different key', () => {
    const tree = {
      receiver: 'default',
      routes: [
        { receiver: 'p1', routes: [{ receiver: 'slack' }] },
        { receiver: 'p2', routes: [{ receiver: 'slack' }] },
      ],
    };
    const flat = flattenRoutes(tree);
    const underP1 = flat.find((r) => r.path === 'root.0.0');
    const underP2 = flat.find((r) => r.path === 'root.1.0');
    expect(underP1?.key).not.toBe(underP2?.key);
  });

  test('reordering siblings changes their path but not their key', () => {
    const a = { receiver: 'pagerduty' };
    const b = { receiver: 'slack' };
    const forward = flattenRoutes({ receiver: 'default', routes: [a, b] });
    const reversed = flattenRoutes({ receiver: 'default', routes: [b, a] });
    const keysOf = (flat: typeof forward) => flat.map((r) => r.key).sort();
    expect(keysOf(forward)).toEqual(keysOf(reversed));
  });
});
