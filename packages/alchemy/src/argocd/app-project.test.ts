/**
 * `ArgoCD.AppProject` against a fake Argo CD — Distilled's real path assembly and
 * `catchTag('NotFound')`, plus reconcile no-op / create / delete-idempotent.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { spec } from './app-project.ts';
import { fakeArgocd, fakeArgocdLayer, fakeFailure } from './fake-argocd.ts';
import { argocdOperations } from './resource.ts';

const PROJECT_PATH = '/api/v1/projects/platform';
const CREATE_PATH = '/api/v1/projects';

const liveJson = {
  metadata: { name: 'platform' },
  spec: {
    description: 'platform apps',
    destinations: [{ namespace: '*', server: 'https://kubernetes.default.svc' }],
    sourceRepos: ['https://git.example.com/org/gitops.git'],
  },
};

const props = {
  description: 'platform apps',
  destinations: [{ namespace: '*', server: 'https://kubernetes.default.svc' }],
  name: 'platform',
  sourceRepos: ['https://git.example.com/org/gitops.git'],
};

describe('ArgoCD.AppProject spec', () => {
  test('a live project decodes into typed attributes', async () => {
    const fake = fakeArgocd((method, url) =>
      method === 'GET' && url.pathname === PROJECT_PATH
        ? Response.json(liveJson)
        : fakeFailure(404, 'not found'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(live !== undefined && spec.attributes(live, props)).toEqual({
      description: 'platform apps',
      destinations: [{ name: '', namespace: '*', server: 'https://kubernetes.default.svc' }],
      name: 'platform',
      sourceRepos: ['https://git.example.com/org/gitops.git'],
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
      method === 'GET' && url.pathname === PROJECT_PATH
        ? Response.json(liveJson)
        : fakeFailure(500, 'should not write'),
    );
    await Effect.runPromise(ops.reconcile(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))));
    expect(fake.seen.every((row) => row.method === 'GET')).toBe(true);
  });

  test('an absent project is created', async () => {
    let created = false;
    const fake = fakeArgocd((method, url) => {
      if (method === 'GET' && url.pathname === PROJECT_PATH) {
        return created ? Response.json(liveJson) : fakeFailure(404, 'not found');
      }
      if (method === 'POST' && url.pathname === CREATE_PATH) {
        created = true;
        return Response.json(liveJson);
      }
      return fakeFailure(500, 'unexpected');
    });
    await Effect.runPromise(ops.reconcile(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))));
    expect(fake.seen.some((row) => row.method === 'POST')).toBe(true);
  });

  test('destroying an absent project sends no DELETE', async () => {
    const fake = fakeArgocd(() => fakeFailure(404, 'not found'));
    await Effect.runPromise(ops.destroy(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))));
    expect(fake.seen).toEqual([{ method: 'GET', path: PROJECT_PATH }]);
  });
});
