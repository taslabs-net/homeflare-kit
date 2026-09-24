/**
 * `ArgoCD.Application` against a fake Argo CD, proving tagged-error paths and the
 * observe-before-write "adopt" posture (S9/S10) through the REAL `@distilled.cloud/argocd`
 * protocol — not re-implemented by hand. Mirrors `../grafana/datasource.test.ts`.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { spec } from './application.ts';
import { fakeArgocd, fakeArgocdLayer, fakeFailure } from './fake-argocd.ts';
import { argocdOperations } from './resource.ts';

const APP_PATH = '/api/v1/applications/cluster-apps';
const CREATE_PATH = '/api/v1/applications';

const liveJson = {
  metadata: { name: 'cluster-apps', uid: 'uid-app-1' },
  spec: {
    destination: { namespace: 'argocd', server: 'https://kubernetes.default.svc' },
    project: 'platform',
    source: {
      path: 'apps/platform',
      repoURL: 'https://git.example.com/org/gitops.git',
      targetRevision: 'main',
    },
    syncPolicy: { automated: { prune: true, selfHeal: true } },
  },
  status: { health: { status: 'Healthy' }, sync: { status: 'Synced' } },
};

const props = {
  destination: { namespace: 'argocd', server: 'https://kubernetes.default.svc' },
  name: 'cluster-apps',
  project: 'platform',
  source: {
    path: 'apps/platform',
    repoURL: 'https://git.example.com/org/gitops.git',
    targetRevision: 'main',
  },
  syncPolicy: { automated: { prune: true, selfHeal: true } },
};

describe('spec.fetchLive', () => {
  test('a live application decodes into typed attributes', async () => {
    const fake = fakeArgocd((method, url) =>
      method === 'GET' && url.pathname === APP_PATH
        ? Response.json(liveJson)
        : fakeFailure(404, 'not found'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(live !== undefined && spec.attributes(live, props)).toEqual({
      destination: { name: '', namespace: 'argocd', server: 'https://kubernetes.default.svc' },
      health: 'Healthy',
      name: 'cluster-apps',
      project: 'platform',
      source: {
        chart: '',
        path: 'apps/platform',
        repoURL: 'https://git.example.com/org/gitops.git',
        targetRevision: 'main',
      },
      syncPolicy: {
        allowEmpty: false,
        automated: true,
        prune: true,
        selfHeal: true,
        syncOptions: [],
      },
      syncStatus: 'Synced',
      uid: 'uid-app-1',
    });
    expect(fake.seen).toEqual([{ method: 'GET', path: APP_PATH }]);
  });

  test('a 404 folds to undefined — the exact idiom this family uses', async () => {
    const fake = fakeArgocd(() => fakeFailure(404, 'application not found'));
    const result = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(result).toBeUndefined();
  });

  test('a 401 propagates — Unauthorized is a real failure, never folded to absent', async () => {
    const fake = fakeArgocd(() => fakeFailure(401, 'bad token'));
    const failure = await Effect.runPromise(
      Effect.flip(spec.fetchLive(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('Unauthorized');
  });
});

describe('argocdOperations(spec) — read / reconcile / destroy', () => {
  const ops = argocdOperations(spec);

  test('cold read of a live application is Unowned (H1)', async () => {
    const fake = fakeArgocd((method, url) =>
      method === 'GET' && url.pathname === APP_PATH
        ? Response.json(liveJson)
        : fakeFailure(500, 'unexpected'),
    );
    const result = await Effect.runPromise(
      ops
        .read({ olds: props, output: undefined })
        .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(Unowned.is(result)).toBe(true);
  });

  test('warm read of a live application is plain attributes, not Unowned', async () => {
    const fake = fakeArgocd((method, url) =>
      method === 'GET' && url.pathname === APP_PATH
        ? Response.json(liveJson)
        : fakeFailure(500, 'unexpected'),
    );
    const result = await Effect.runPromise(
      ops
        .read({ olds: props, output: spec.attributes(liveJson, props) })
        .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(Unowned.is(result)).toBe(false);
    expect(result).toMatchObject({ name: 'cluster-apps', uid: 'uid-app-1' });
  });

  test('declaring exactly what is live is a noop: no create or update is ever sent', async () => {
    const fake = fakeArgocd((method, url) =>
      method === 'GET' && url.pathname === APP_PATH
        ? Response.json(liveJson)
        : fakeFailure(500, 'reconcile should not write when nothing changed'),
    );
    const after = await Effect.runPromise(
      ops.reconcile(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(after.name).toBe('cluster-apps');
    expect(fake.seen.every((row) => row.method === 'GET')).toBe(true);
  });

  test('a genuinely absent name is created, then read back', async () => {
    let created = false;
    const fake = fakeArgocd((method, url) => {
      if (method === 'GET' && url.pathname === APP_PATH) {
        return created ? Response.json(liveJson) : fakeFailure(404, 'not found');
      }
      if (method === 'POST' && url.pathname === CREATE_PATH) {
        created = true;
        return Response.json(liveJson);
      }
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(ops.reconcile(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))));
    expect(fake.seen.some((row) => row.method === 'POST' && row.path === CREATE_PATH)).toBe(true);
  });

  test('destroying a live application sends DELETE', async () => {
    const fake = fakeArgocd((method, url) => {
      if (method === 'GET' && url.pathname === APP_PATH) return Response.json(liveJson);
      if (method === 'DELETE' && url.pathname === APP_PATH) return Response.json({});
      return fakeFailure(500, 'unexpected request');
    });
    await Effect.runPromise(ops.destroy(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))));
    expect(fake.seen).toEqual([
      { method: 'GET', path: APP_PATH },
      { method: 'DELETE', path: APP_PATH },
    ]);
  });

  test('destroying an absent name sends no DELETE — idempotent (S11)', async () => {
    const fake = fakeArgocd(() => fakeFailure(404, 'not found'));
    await Effect.runPromise(ops.destroy(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))));
    expect(fake.seen).toEqual([{ method: 'GET', path: APP_PATH }]);
  });
});
