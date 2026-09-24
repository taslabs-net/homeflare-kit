/**
 * `Grafana.Dashboard` against a fake Grafana — the noop-despite-volatile-fields normalization, the
 * provisioned-object refusal, and 412 propagating as a genuine failure rather than being caught or
 * overwritten blindly. Mirrors `datasource.test.ts`/`folder.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { spec } from './dashboard.ts';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { GrafanaProvisionedObjectError } from './provisioned.ts';
import { grafanaOperations } from './resource.ts';

const DASH_PATH = '/api/dashboards/uid/fleet-overview';
const CREATE_PATH = '/api/dashboards/db';

const model = { panels: [{ id: 1, title: 'CPU' }], title: 'Fleet Overview' };

const liveJson = {
  dashboard: { ...model, id: 42, uid: 'fleet-overview', version: 3 },
  meta: {
    folderUid: 'infra',
    provisioned: false,
    provisionedExternalId: '',
    url: '/d/fleet-overview',
    version: 3,
  },
};

const props = { dashboard: model, folderUid: 'infra', uid: 'fleet-overview' };

describe('spec.fetchLive', () => {
  test('a live dashboard decodes and normalizes into typed attributes', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === DASH_PATH
        ? Response.json(liveJson)
        : fakeFailure(404, 'not found'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(live !== undefined && spec.attributes(live, props)).toEqual({
      dashboard: { ...model, uid: 'fleet-overview' },
      folderUid: 'infra',
      provisioned: false,
      provisionedExternalId: '',
      title: 'Fleet Overview',
      uid: 'fleet-overview',
      url: '/d/fleet-overview',
      version: 3,
    });
    expect(fake.bodies[0]).toBeUndefined();
  });

  test('a 404 folds to undefined', async () => {
    const fake = fakeGrafana(() => fakeFailure(404, 'dashboard not found'));
    const result = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(result).toBeUndefined();
  });
});

describe('create', () => {
  test('sends the normalized model and folderUid — no volatile fields, no extra keys', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'POST' && url.pathname === CREATE_PATH
        ? Response.json({
            folderUid: 'infra',
            id: 42,
            status: 'success',
            title: 'Fleet Overview',
            uid: 'fleet-overview',
            url: '/d/fleet-overview',
            version: 1,
          })
        : fakeFailure(404, 'unexpected request'),
    );
    await Effect.runPromise(spec.create(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))));
    expect(fake.bodies[0]).toEqual({
      dashboard: { ...model, uid: 'fleet-overview' },
      folderUid: 'infra',
    });
  });
});

describe('reconcile — noop despite volatile fields', () => {
  test('a declared model matching live content is a noop even though id/version/iteration differ', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === DASH_PATH
        ? Response.json(liveJson)
        : fakeFailure(500, 'reconcile should not write when content is unchanged'),
    );
    const after = await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile(props)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(after.uid).toBe('fleet-overview');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });
});

describe('update', () => {
  // ★ ALL THREE TESTS GO THROUGH `grafanaOperations(spec).reconcile`, NOT `spec.update` DIRECTLY —
  //   `update` is optional on the shared `GrafanaSpec` type, and `reconcile` is what production
  //   code actually calls; it also exercises the SAME `fetchLive` → `matches` → `update` sequence a
  //   real plan/deploy does, rather than a hand-assembled `live` argument.
  test('a content change sends the live version for optimistic concurrency, never overwrite', async () => {
    const changed = { ...model, title: 'Fleet Overview v2' };
    let saved = false;
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === DASH_PATH) {
        return Response.json(
          saved
            ? {
                dashboard: { ...changed, id: 42, uid: 'fleet-overview', version: 4 },
                meta: { ...liveJson.meta, version: 4 },
              }
            : liveJson,
        );
      }
      if (method === 'POST' && url.pathname === CREATE_PATH) {
        saved = true;
        return Response.json({
          folderUid: 'infra',
          id: 42,
          status: 'success',
          title: 'Fleet Overview v2',
          uid: 'fleet-overview',
          url: '/d/fleet-overview',
          version: 4,
        });
      }
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile({ ...props, dashboard: changed })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    const post = fake.seen.findIndex((s) => s.method === 'POST');
    expect(fake.bodies[post]).toMatchObject({
      dashboard: { ...changed, uid: 'fleet-overview', version: 3 },
    });
    // ⛔ `overwrite` IS NEVER SET — Grafana's own version check stays live on every update.
    expect((fake.bodies[post] as { overwrite?: boolean }).overwrite).toBeUndefined();
  });

  test('a 412 from a concurrent save propagates — never caught, never retried here', async () => {
    const changed = { ...model, title: 'Fleet Overview v2' };
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === DASH_PATH) return Response.json(liveJson);
      if (method === 'POST' && url.pathname === CREATE_PATH) {
        return fakeFailure(412, 'The dashboard has been changed by someone else');
      }
      return fakeFailure(500, 'unexpected request');
    });
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile({ ...props, dashboard: changed })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('PreconditionFailed');
  });

  test('a provisioned dashboard refuses the write, naming its owning file', async () => {
    const provisioned = {
      ...liveJson,
      meta: { ...liveJson.meta, provisioned: true, provisionedExternalId: 'dashboards/fleet.json' },
    };
    const changed = { ...model, title: 'Fleet Overview v2' };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === DASH_PATH
        ? Response.json(provisioned)
        : fakeFailure(500, 'no write should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile({ ...props, dashboard: changed })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(failure.message).toContain('dashboards/fleet.json');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });
});

describe('destroy', () => {
  test('deletes a live, non-provisioned dashboard by uid', async () => {
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === DASH_PATH) return Response.json(liveJson);
      if (method === 'DELETE' && url.pathname === DASH_PATH) {
        return Response.json({ message: 'ok', title: 'Fleet Overview', uid: 'fleet-overview' });
      }
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .destroy(props)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen).toEqual([
      { method: 'GET', path: DASH_PATH },
      { method: 'DELETE', path: DASH_PATH },
    ]);
  });

  test('a provisioned dashboard refuses destroy and sends no DELETE', async () => {
    const provisioned = {
      ...liveJson,
      meta: { ...liveJson.meta, provisioned: true, provisionedExternalId: 'dashboards/fleet.json' },
    };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === DASH_PATH
        ? Response.json(provisioned)
        : fakeFailure(500, 'no DELETE should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .destroy(props)
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(fake.seen).toEqual([{ method: 'GET', path: DASH_PATH }]);
  });
});
