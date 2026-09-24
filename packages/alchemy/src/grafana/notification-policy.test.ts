/**
 * `Grafana.NotificationPolicy` against a fake Grafana — the singleton read (never `undefined`),
 * reconcile's adopt-and-update-only posture, and route-order significance. Provenance/reset-gate
 * tests: `notification-policy-refusals.test.ts`. Drop-warning tests:
 * `notification-policy-drop-warning.test.ts` — split to keep each file under the house's
 * 250-line cap. Mirrors `alert-rule-group.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { PATH, declaredRoute, liveTree, props } from './notification-policy-fixtures.ts';
import { spec } from './notification-policy.ts';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { grafanaOperations } from './resource.ts';

describe('spec.fetchLive', () => {
  test('a live tree decodes and normalizes into typed attributes', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH ? Response.json(liveTree) : fakeFailure(404, 'x'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(live !== undefined && spec.attributes(live, props)).toEqual({
      provenance: 'api',
      route: declaredRoute,
    });
    expect(fake.bodies[0]).toBeUndefined();
  });

  test('a 403 propagates — never folded to absent, and there is nothing TO fold to (no NotFound case)', async () => {
    const fake = fakeGrafana(() => fakeFailure(403, 'forbidden'));
    const failure = await Effect.runPromise(
      Effect.flip(spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('Forbidden');
  });
});

describe('reconcile — adopt-and-update-only, never create', () => {
  test('declaring exactly what is live is a noop: no write is ever sent', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH
        ? Response.json(liveTree)
        : fakeFailure(500, 'reconcile should not write when nothing changed'),
    );
    await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile(props)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('a content change PUTs the declared tree, never a create call', async () => {
    const changed = { ...declaredRoute, receiver: 'other-receiver' };
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === PATH) return Response.json(liveTree);
      if (method === 'PUT' && url.pathname === PATH) {
        return Response.json({ ...liveTree, receiver: 'other-receiver' });
      }
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile({ route: changed })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    const put = fake.seen.findIndex((s) => s.method === 'PUT');
    expect(put).toBeGreaterThanOrEqual(0);
    expect(fake.bodies[put]).toMatchObject({ receiver: 'other-receiver' });
  });
});

describe('route order significant', () => {
  test('the same two routes reversed shows a mismatch', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === PATH ? Response.json(liveTree) : fakeFailure(500, 'x'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    const attrs = live !== undefined ? spec.attributes(live, props) : undefined;
    const reversed = { route: { ...declaredRoute, routes: [...declaredRoute.routes].reverse() } };
    expect(attrs !== undefined && spec.matches(attrs, reversed)).toBe(false);
  });
});
