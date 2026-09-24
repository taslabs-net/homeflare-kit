/**
 * `Grafana.ContactPoint` against a fake Grafana — the list-then-filter-by-uid read (no by-uid GET
 * exists), the observe-before-write "adopt" posture, and subset-match tolerance. Mirrors
 * `datasource.test.ts`. Secure-settings-ref tests: `contact-point-secrets.test.ts`. Provenance
 * refusal tests (foreign and missing): `contact-point-provenance.test.ts` — split out to keep each
 * file under the house's 250-line cap.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { ITEM_PATH, LIST_PATH, liveJson, props } from './contact-point-fixtures.ts';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { grafanaOperations } from './resource.ts';
import { spec } from './contact-point.ts';

describe('spec.fetchLive', () => {
  test('lists and filters by uid client-side — no by-uid GET route exists', async () => {
    const other = { ...liveJson, name: 'Other', uid: 'other' };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === LIST_PATH
        ? Response.json([other, liveJson])
        : fakeFailure(404, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(live !== undefined && spec.attributes(live, props)).toEqual({
      disableResolveMessage: false,
      name: 'On-call Slack',
      provenance: 'api',
      settings: { recipient: '#oncall' },
      type: 'slack',
      uid: 'slack-oncall',
    });
    // ⛔ THE POINT: a GET never carries a body.
    expect(fake.bodies[0]).toBeUndefined();
  });

  test('a uid absent from the list decodes to undefined, not an error', async () => {
    const fake = fakeGrafana(() => Response.json([]));
    const result = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(result).toBeUndefined();
  });

  test('a 403 propagates — never folded to absent', async () => {
    const fake = fakeGrafana(() => fakeFailure(403, 'forbidden'));
    const failure = await Effect.runPromise(
      Effect.flip(spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('Forbidden');
  });
});

describe('subset match — tolerates a default Grafana injects into settings', () => {
  test('an unchanged declaration is a noop despite an extra live settings field it never declared', async () => {
    const decorated = { ...liveJson, settings: { ...liveJson.settings, severity: 'critical' } };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === LIST_PATH
        ? Response.json([decorated])
        : fakeFailure(500, 'reconcile should not write when content is unchanged'),
    );
    const after = await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile(props)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(after.uid).toBe('slack-oncall');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });
});

describe('reconcile — adopt semantics', () => {
  test('declaring exactly what is live is a noop: no write is ever sent', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === LIST_PATH
        ? Response.json([liveJson])
        : fakeFailure(500, 'reconcile should not write when nothing changed'),
    );
    const after = await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile(props)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(after.uid).toBe('slack-oncall');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });
});

describe('update and destroy — normal, api-provenance writes', () => {
  test("an api-provenance contact point (this family's own writes) updates normally", async () => {
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === LIST_PATH) return Response.json([liveJson]);
      if (method === 'PUT' && url.pathname === ITEM_PATH) {
        return Response.json({ ...liveJson, name: 'Renamed' });
      }
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile({ ...props, name: 'Renamed' })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen.some((s) => s.method === 'PUT' && s.path === ITEM_PATH)).toBe(true);
  });

  test('deletes a live, api-provenance contact point by uid', async () => {
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === LIST_PATH) return Response.json([liveJson]);
      if (method === 'DELETE' && url.pathname === ITEM_PATH) return Response.json({});
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .destroy(props)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen).toEqual([
      { method: 'GET', path: LIST_PATH },
      { method: 'DELETE', path: ITEM_PATH },
    ]);
  });
});
