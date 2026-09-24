/**
 * `ArgoCD.ApplicationSet` against a fake Argo CD — Distilled create/get/delete, upsert-on-update
 * (no dedicated update op), reconcile no-op, and idempotent delete.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { spec } from './application-set.ts';
import { fakeArgocd, fakeArgocdLayer, fakeFailure } from './fake-argocd.ts';
import { argocdOperations } from './resource.ts';

const SET_PATH = '/api/v1/applicationsets/cluster-apps';
const CREATE_PATH = '/api/v1/applicationsets';

const liveJson = {
  metadata: { name: 'cluster-apps' },
  spec: {
    generators: [
      {
        git: {
          directories: [{ path: 'apps/*' }],
          repoURL: 'https://git.example.com/org/gitops.git',
          revision: 'main',
        },
      },
    ],
    goTemplate: true,
    template: {
      metadata: { name: '{{.path.basename}}' },
      spec: {
        destination: { namespace: '{{.path.basename}}', server: 'https://kubernetes.default.svc' },
        project: 'platform',
        source: {
          path: '{{.path.path}}',
          repoURL: 'https://git.example.com/org/gitops.git',
          targetRevision: 'main',
        },
      },
    },
  },
};

const props = {
  generators: [
    {
      git: {
        directories: [{ path: 'apps/*' }],
        repoURL: 'https://git.example.com/org/gitops.git',
        revision: 'main',
      },
    },
  ],
  goTemplate: true,
  name: 'cluster-apps',
  template: {
    destination: { namespace: '{{.path.basename}}', server: 'https://kubernetes.default.svc' },
    name: '{{.path.basename}}',
    project: 'platform',
    source: {
      path: '{{.path.path}}',
      repoURL: 'https://git.example.com/org/gitops.git',
      targetRevision: 'main',
    },
  },
};

describe('ArgoCD.ApplicationSet spec', () => {
  test('a live applicationset decodes into typed attributes', async () => {
    const fake = fakeArgocd((method, url) =>
      method === 'GET' && url.pathname === SET_PATH
        ? Response.json(liveJson)
        : fakeFailure(404, 'not found'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(live !== undefined && spec.attributes(live, props)).toMatchObject({
      gitDirectories: ['apps/*'],
      gitRepoURLs: ['https://git.example.com/org/gitops.git'],
      goTemplate: true,
      name: 'cluster-apps',
      templateName: '{{.path.basename}}',
      templateProject: 'platform',
    });
  });

  test('a 404 folds to undefined', async () => {
    const fake = fakeArgocd(() => fakeFailure(404, 'not found'));
    expect(
      await Effect.runPromise(
        spec.fetchLive(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
      ),
    ).toBeUndefined();
  });
});

describe('reconcile / destroy', () => {
  const ops = argocdOperations(spec);

  test('declaring exactly what is live sends no write', async () => {
    const fake = fakeArgocd((method, url) =>
      method === 'GET' && url.pathname === SET_PATH
        ? Response.json(liveJson)
        : fakeFailure(500, 'should not write'),
    );
    await Effect.runPromise(ops.reconcile(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))));
    expect(fake.seen.every((row) => row.method === 'GET')).toBe(true);
  });

  test('drift updates via POST ?upsert=true — Distilled has no ApplicationSet PUT', async () => {
    let upserted = false;
    const drifted = {
      ...liveJson,
      spec: { ...liveJson.spec, goTemplate: false },
    };
    const fake = fakeArgocd((method, url) => {
      if (method === 'GET' && url.pathname === SET_PATH) {
        return Response.json(upserted ? liveJson : drifted);
      }
      if (method === 'POST' && url.pathname === CREATE_PATH) {
        upserted = true;
        return Response.json(liveJson);
      }
      return fakeFailure(500, 'unexpected');
    });
    await Effect.runPromise(ops.reconcile(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))));
    expect(
      fake.seen.some((row) => row.method === 'POST' && row.path === `${CREATE_PATH}?upsert=true`),
    ).toBe(true);
  });

  test('destroying an absent set sends no DELETE', async () => {
    const fake = fakeArgocd(() => fakeFailure(404, 'not found'));
    await Effect.runPromise(ops.destroy(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))));
    expect(fake.seen).toEqual([{ method: 'GET', path: SET_PATH }]);
  });
});
