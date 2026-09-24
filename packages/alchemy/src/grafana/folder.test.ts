/**
 * `Grafana.Folder` against a fake Grafana — the observe-before-write "adopt" posture (S9/S10),
 * the provisioned-object refusal (provisioned.ts) and the parentUid-is-create-only refusal, all
 * through the REAL `@distilled.cloud/grafana` protocol. Mirrors `datasource.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { GrafanaFolderReparentError, spec } from './folder.ts';
import { GrafanaProvisionedObjectError } from './provisioned.ts';
import { grafanaOperations } from './resource.ts';

const FOLDER_PATH = '/api/folders/team-dashboards';
const CREATE_PATH = '/api/folders';

const liveJson = {
  id: 3,
  managedBy: '',
  parentUid: '',
  title: 'Team Dashboards',
  uid: 'team-dashboards',
  url: '/dashboards/f/team-dashboards',
  version: 1,
};

const props = { title: 'Team Dashboards', uid: 'team-dashboards' };

describe('spec.fetchLive', () => {
  test('a live folder decodes into typed attributes', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === FOLDER_PATH
        ? Response.json(liveJson)
        : fakeFailure(404, 'not found'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(live !== undefined && spec.attributes(live, props)).toEqual({
      id: 3,
      managedBy: '',
      parentUid: '',
      title: 'Team Dashboards',
      uid: 'team-dashboards',
      url: '/dashboards/f/team-dashboards',
      version: 1,
    });
    expect(fake.seen).toEqual([{ method: 'GET', path: FOLDER_PATH }]);
    // ⛔ THE POINT: a GET never carries a body — see the shared memory's "distilled JSON-encodes
    //   unknown keys as a body even on a GET" trap.
    expect(fake.bodies[0]).toBeUndefined();
  });

  test('a 404 folds to undefined', async () => {
    const fake = fakeGrafana(() => fakeFailure(404, 'folder not found'));
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

describe('create', () => {
  test('sends only declared fields — parentUid omitted when undeclared', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'POST' && url.pathname === CREATE_PATH
        ? Response.json(liveJson)
        : fakeFailure(404, 'unexpected request'),
    );
    await Effect.runPromise(spec.create(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))));
    expect(fake.bodies[0]).toEqual({ title: 'Team Dashboards', uid: 'team-dashboards' });
  });

  test('sends description and parentUid when declared', async () => {
    const fake = fakeGrafana(() => Response.json(liveJson));
    await Effect.runPromise(
      spec
        .create({ ...props, description: 'squad dashboards', parentUid: 'engineering' })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.bodies[0]).toMatchObject({
      description: 'squad dashboards',
      parentUid: 'engineering',
    });
  });
});

describe('reconcile — adopt semantics', () => {
  test('declaring exactly what is live is a noop: no write is ever sent', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === FOLDER_PATH
        ? Response.json(liveJson)
        : fakeFailure(500, 'reconcile should not write when nothing changed'),
    );
    const after = await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile(props)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(after.uid).toBe('team-dashboards');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });
});

describe('update', () => {
  test('a title mismatch sends the live version for optimistic concurrency', async () => {
    let updated = false;
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === FOLDER_PATH) {
        return Response.json(updated ? { ...liveJson, title: 'Renamed' } : liveJson);
      }
      if (method === 'PUT' && url.pathname === FOLDER_PATH) {
        updated = true;
        return Response.json({ ...liveJson, title: 'Renamed' });
      }
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .reconcile({ ...props, title: 'Renamed' })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    const put = fake.seen.findIndex((s) => s.method === 'PUT');
    expect(put).toBeGreaterThanOrEqual(0);
    expect(fake.bodies[put]).toMatchObject({ title: 'Renamed', version: 1 });
  });

  // ★ BOTH TESTS GO THROUGH `grafanaOperations(spec).reconcile`, NOT `spec.update` DIRECTLY —
  //   `update` is optional on the shared `GrafanaSpec` type, and `reconcile` is what production
  //   code actually calls; it also exercises the same `fetchLive` → `matches` → `update` sequence.
  test('a parentUid mismatch refuses — updateFolder cannot reparent', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === FOLDER_PATH
        ? Response.json(liveJson)
        : fakeFailure(500, 'no write should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile({ ...props, parentUid: 'engineering' })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaFolderReparentError);
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('a provisioned (managedBy set) folder refuses the write and sends nothing', async () => {
    const provisioned = { ...liveJson, managedBy: 'repo' };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === FOLDER_PATH
        ? Response.json(provisioned)
        : fakeFailure(500, 'no write should be attempted'),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        grafanaOperations(spec)
          .reconcile({ ...props, title: 'Renamed' })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaProvisionedObjectError);
    expect(failure.message).toContain('repo');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });
});

describe('destroy', () => {
  test('deletes a live, non-provisioned folder by uid', async () => {
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === FOLDER_PATH) return Response.json(liveJson);
      if (method === 'DELETE' && url.pathname === FOLDER_PATH) {
        return Response.json({ id: 3, message: 'ok', title: 'Team Dashboards' });
      }
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .destroy(props)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen).toEqual([
      { method: 'GET', path: FOLDER_PATH },
      { method: 'DELETE', path: FOLDER_PATH },
    ]);
  });

  test('a provisioned folder refuses destroy and sends no DELETE', async () => {
    const provisioned = { ...liveJson, managedBy: 'repo' };
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === FOLDER_PATH
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
    expect(fake.seen).toEqual([{ method: 'GET', path: FOLDER_PATH }]);
  });
});
