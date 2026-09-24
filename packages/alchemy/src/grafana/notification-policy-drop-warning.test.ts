/**
 * `warnOnDroppedRoutes` — pure logic, then wired through `diff`/`update` on a fake Grafana. Mirrors
 * `alert-rule-group-drop-warning.test.ts`: captures `Effect.logWarning` with a `Logger`, the house
 * pattern `caddy/config-format-warning.test.ts` established.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Logger from 'effect/Logger';
import { PATH, liveTree, props } from './notification-policy-fixtures.ts';
import { handlers, spec } from './notification-policy.ts';
import { warnOnDroppedRoutes } from './notification-policy-drop-warning.ts';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { grafanaOperations } from './resource.ts';

const withWarnings = async <A>(effect: Effect.Effect<A, unknown, never>) => {
  const warnings: string[] = [];
  const collect = Logger.make((options) => {
    if (options.logLevel === 'Warn') warnings.push(String(options.message));
  });
  const value = await Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([collect]))));
  return { value, warnings };
};

describe('warnOnDroppedRoutes — pure', () => {
  test('logs nothing when the declared tree already has every live route', async () => {
    const tree = { receiver: 'default', routes: [{ receiver: 'pagerduty' }] };
    const { warnings } = await withWarnings(warnOnDroppedRoutes(tree, tree));
    expect(warnings).toEqual([]);
  });

  test('names a dropped nested route by receiver and path', async () => {
    const declared = { receiver: 'default', routes: [{ receiver: 'pagerduty' }] };
    const live = {
      receiver: 'default',
      routes: [{ receiver: 'pagerduty' }, { matchers: ['team=x'], receiver: 'slack' }],
    };
    const { warnings } = await withWarnings(warnOnDroppedRoutes(declared, live));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('slack (root.1)');
  });

  test('a changed root receiver is never reported as "dropped" — root is replaced, not removed', async () => {
    const { warnings } = await withWarnings(
      warnOnDroppedRoutes({ receiver: 'new' }, { receiver: 'old' }),
    );
    expect(warnings).toEqual([]);
  });

  test('the same two routes reordered logs nothing — reordering is not dropping', async () => {
    // ⛔ THE POINT: `matches()` (subset-match's position-significant array rule) still shows
    //   `update` for a reorder — this warning stays silent because nothing is actually REMOVED,
    //   complementing rather than duplicating that signal.
    const a = { receiver: 'pagerduty' };
    const b = { receiver: 'slack' };
    const { warnings } = await withWarnings(
      warnOnDroppedRoutes(
        { receiver: 'default', routes: [b, a] },
        { receiver: 'default', routes: [a, b] },
      ),
    );
    expect(warnings).toEqual([]);
  });

  test('a duplicate route added live warns — the multiset fix, not the original Set collision', async () => {
    // ⛔ THE REGRESSION AN ADVERSARIAL REVIEW OF THIS PR FOUND: the first version's `Set`-based
    //   identity collided this duplicate with the already-declared one and warned nothing, even
    //   though the PUT drops it. `severity=warning` -> `slack` is declared once; live has it TWICE.
    const declared = {
      receiver: 'default',
      routes: [
        { matchers: ['severity=warning'], receiver: 'slack' },
        { matchers: ['severity=critical'], receiver: 'pagerduty' },
      ],
    };
    const live = {
      receiver: 'default',
      routes: [
        { matchers: ['severity=warning'], receiver: 'slack' },
        { matchers: ['severity=critical'], receiver: 'pagerduty' },
        { matchers: ['severity=warning'], receiver: 'slack' },
      ],
    };
    const { warnings } = await withWarnings(warnOnDroppedRoutes(declared, live));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('REMOVES 1 route');
    expect(warnings[0]).toContain('slack (root.2)');
  });

  test('an identical route under a DIFFERENT (undeclared) parent still warns — distinct lineage', async () => {
    const declared = {
      receiver: 'default',
      routes: [{ receiver: 'p1', routes: [{ receiver: 'slack' }] }],
    };
    const live = {
      receiver: 'default',
      routes: [
        { receiver: 'p1', routes: [{ receiver: 'slack' }] },
        { receiver: 'p2', routes: [{ receiver: 'slack' }] },
      ],
    };
    const { warnings } = await withWarnings(warnOnDroppedRoutes(declared, live));
    expect(warnings).toHaveLength(1);
    // ⛔ NOT root.0.0 (that one IS declared, under p1) — the dropped one is the p2 lineage's.
    expect(warnings[0]).toContain('slack (root.1.0)');
  });

  test('two declared duplicates vs two live duplicates warns nothing — counts match', async () => {
    const pair = {
      receiver: 'default',
      routes: [{ receiver: 'slack' }, { receiver: 'slack' }],
    };
    const { warnings } = await withWarnings(warnOnDroppedRoutes(pair, pair));
    expect(warnings).toEqual([]);
  });
});

describe('wired into diff and update', () => {
  test('diff logs the dropped-route warning before anything is written', async () => {
    const extra = { matchers: ['team=x'], receiver: 'slack' };
    const withExtra = { ...liveTree, routes: [...liveTree.routes, extra] };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(withExtra)
        : fakeFailure(500, 'diff should not write'),
    );
    const { warnings, value } = await withWarnings(
      handlers
        .diff({ news: props, output: { provenance: 'api', route: props.route } })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))) as Effect.Effect<
        unknown,
        unknown,
        never
      >,
    );
    // ⚠️ NOT 'noop': subset-match's array rule requires EXACT length, so live carrying one MORE
    //   route than declared already disagrees on its own — the warning and the mismatch are the
    //   same signal here, not independent (see the file header on `matches` vs this warning).
    expect(value).toEqual({ action: 'update' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('slack');
  });

  test('update logs the same warning right before the PUT that would drop the route', async () => {
    const extra = { matchers: ['team=x'], receiver: 'slack' };
    const withExtra = { ...liveTree, routes: [...liveTree.routes, extra] };
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === PATH) return Response.json(withExtra);
      if (method === 'PUT' && url.pathname === PATH) return Response.json(withExtra);
      return fakeFailure(500, 'unexpected request');
    });
    const { warnings } = await withWarnings(
      grafanaOperations(spec)
        .reconcile({ route: { ...props.route, receiver: 'changed' } })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))) as Effect.Effect<
        unknown,
        unknown,
        never
      >,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('slack');
  });
});
