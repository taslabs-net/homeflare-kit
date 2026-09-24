/**
 * `Grafana.Datasource` against a fake Grafana, proving the tagged-error paths, the secure-field
 * reference seam (S25) and the observe-before-write "adopt" posture (S9/S10) — all through the
 * REAL `@distilled.cloud/grafana` protocol (path assembly, JSON decode, status→typed-error
 * matching), not re-implemented by hand. Mirrors `../forgejo/repository.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { fakeFailure, fakeGrafana, fakeGrafanaLayer } from './fake-grafana.ts';
import { grafanaOperations } from './resource.ts';
import { GrafanaSecretRefUnsetError, spec } from './datasource.ts';

const DS_PATH = '/api/datasources/uid/teslamate';
const CREATE_PATH = '/api/datasources';

const liveJson = {
  access: 'proxy',
  id: 7,
  isDefault: true,
  name: 'TeslaMate',
  orgId: 1,
  readOnly: false,
  type: 'postgres',
  uid: 'teslamate',
  url: '127.0.0.1:5432',
  version: 1,
};

const props = { name: 'TeslaMate', type: 'postgres', uid: 'teslamate' };

describe('spec.fetchLive', () => {
  test('a live datasource decodes into typed attributes', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === DS_PATH
        ? Response.json(liveJson)
        : fakeFailure(404, 'not found'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(live?.name).toBe('TeslaMate');
    expect(live !== undefined && spec.attributes(live, props)).toEqual({
      access: 'proxy',
      id: 7,
      isDefault: true,
      name: 'TeslaMate',
      orgId: 1,
      readOnly: false,
      type: 'postgres',
      uid: 'teslamate',
      url: '127.0.0.1:5432',
      version: 1,
    });
    expect(fake.seen).toEqual([{ method: 'GET', path: DS_PATH }]);
  });

  test('a 404 folds to undefined — the exact idiom this family uses', async () => {
    const fake = fakeGrafana(() => fakeFailure(404, 'Data source not found'));
    const result = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(result).toBeUndefined();
  });

  test('a 401 propagates — Unauthorized is a real failure, never folded to absent', async () => {
    const fake = fakeGrafana(() => fakeFailure(401, 'bad token'));
    const failure = await Effect.runPromise(
      Effect.flip(spec.fetchLive(props).pipe(Effect.provide(fakeGrafanaLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('Unauthorized');
  });
});

describe('secure field references (S25)', () => {
  const ENV_VAR = 'GRAFANA_FAMILY_TEST_DS_PASSWORD';

  test('create resolves the env var fresh and sends it as secureJsonData, never as a prop', async () => {
    process.env[ENV_VAR] = 's3cret';
    try {
      const fake = fakeGrafana((method, url) =>
        method === 'POST' && url.pathname === CREATE_PATH
          ? Response.json({ datasource: liveJson, id: 7, message: 'ok', name: 'TeslaMate' })
          : fakeFailure(404, 'unexpected request'),
      );
      await Effect.runPromise(
        spec
          .create({ ...props, secureJsonDataRefs: { password: ENV_VAR } })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      );
      expect(fake.seen).toEqual([{ method: 'POST', path: CREATE_PATH }]);
      // ⛔ THE POINT OF THIS TEST. Asserting only that a POST landed proves nothing about what it
      //   carried — this is where a dropped `secureJsonData` spread would actually be caught.
      expect(fake.bodies[0]).toMatchObject({ secureJsonData: { password: 's3cret' } });
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test('create refuses with a typed error when the ref is unset — and never sends the request', async () => {
    const fake = fakeGrafana(() => fakeFailure(500, 'should not be reached'));
    const failure = await Effect.runPromise(
      Effect.flip(
        spec
          .create({ ...props, secureJsonDataRefs: { password: 'DEFINITELY_UNSET_VAR_XYZ' } })
          .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(GrafanaSecretRefUnsetError);
    expect(fake.seen).toEqual([]);
  });
});

describe('reconcile — adopt semantics', () => {
  test('declaring exactly what is live is a noop: no create or update is ever sent', async () => {
    const fake = fakeGrafana((method, url) =>
      method === 'GET' && url.pathname === DS_PATH
        ? Response.json(liveJson)
        : fakeFailure(500, 'reconcile should not write when nothing changed'),
    );
    const ops = grafanaOperations(spec);
    const after = await Effect.runPromise(
      ops
        .reconcile({ ...props, access: 'proxy', isDefault: true })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(after.uid).toBe('teslamate');
    expect(fake.seen.every((s) => s.method === 'GET')).toBe(true);
  });

  test('a genuinely absent uid is created', async () => {
    // ⚠️ STATEFUL ON PURPOSE. `reconcile` reads back AFTER writing (S9/S10) — a fake that always
    //   404s the GET would make that read-back indistinguishable from the "write lied" defect
    //   `resource.ts` raises, so the second GET must see what the POST just created.
    let created = false;
    const newOne = { ...liveJson, uid: 'new-one' };
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === '/api/datasources/uid/new-one') {
        return created ? Response.json(newOne) : fakeFailure(404, 'not found');
      }
      if (method === 'POST' && url.pathname === CREATE_PATH) {
        created = true;
        return Response.json({ datasource: newOne, id: 7, message: 'ok', name: 'TeslaMate' });
      }
      return fakeFailure(500, 'unexpected request');
    });
    const ops = grafanaOperations(spec);
    await Effect.runPromise(
      ops
        .reconcile({ ...props, uid: 'new-one' })
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen.some((s) => s.method === 'POST' && s.path === CREATE_PATH)).toBe(true);
  });
});

describe('destroy', () => {
  test('deletes a live datasource by uid', async () => {
    const fake = fakeGrafana((method, url) => {
      if (method === 'GET' && url.pathname === DS_PATH) return Response.json(liveJson);
      if (method === 'DELETE' && url.pathname === DS_PATH) return Response.json({ message: 'ok' });
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(
      grafanaOperations(spec)
        .destroy(props)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen).toEqual([
      { method: 'GET', path: DS_PATH },
      { method: 'DELETE', path: DS_PATH },
    ]);
  });

  test('destroying an absent uid sends no DELETE — idempotent (S11)', async () => {
    const fake = fakeGrafana(() => fakeFailure(404, 'not found'));
    await Effect.runPromise(
      grafanaOperations(spec)
        .destroy(props)
        .pipe(Effect.provide(fakeGrafanaLayer(fake.fetch))),
    );
    expect(fake.seen).toEqual([{ method: 'GET', path: DS_PATH }]);
  });
});
