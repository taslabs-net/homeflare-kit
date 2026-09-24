/**
 * `ArgoCD.Repository` against a fake Argo CD — secret-ref seam (S25), Distilled path
 * encoding of the repo URL, reconcile no-op, create, and idempotent delete.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { fakeArgocd, fakeArgocdLayer, fakeFailure } from './fake-argocd.ts';
import { ArgoCDSecretRefUnsetError, spec } from './repository.ts';
import { argocdOperations } from './resource.ts';

const REPO = 'https://git.example.com/org/gitops.git';
const REPO_PATH = `/api/v1/repositories/${encodeURIComponent(REPO)}`;
const CREATE_PATH = '/api/v1/repositories';

const liveJson = {
  connectionState: { status: 'Successful' },
  name: 'gitops',
  project: 'platform',
  repo: REPO,
  type: 'git',
  username: 'git',
};

const props = {
  name: 'gitops',
  project: 'platform',
  repo: REPO,
  type: 'git' as const,
  username: 'git',
};

describe('spec.fetchLive', () => {
  test('a live repository decodes; the path is Distilled-encoded', async () => {
    const fake = fakeArgocd((method, url) =>
      method === 'GET' && url.pathname === REPO_PATH
        ? Response.json(liveJson)
        : fakeFailure(404, 'not found'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(live !== undefined && spec.attributes(live, props)).toEqual({
      connectionStatus: 'Successful',
      insecure: false,
      name: 'gitops',
      project: 'platform',
      repo: REPO,
      type: 'git',
      username: 'git',
    });
    expect(fake.seen).toEqual([{ method: 'GET', path: REPO_PATH }]);
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

describe('passwordEnv (S25)', () => {
  const ENV_VAR = 'ARGOCD_FAMILY_TEST_REPO_PASSWORD';

  test('create resolves the env var and sends it as password, never as a prop', async () => {
    process.env[ENV_VAR] = 's3cret';
    try {
      const fake = fakeArgocd((method, url) =>
        method === 'POST' && url.pathname === CREATE_PATH
          ? Response.json(liveJson)
          : fakeFailure(404, 'unexpected'),
      );
      await Effect.runPromise(
        spec
          .create({ ...props, passwordEnv: ENV_VAR })
          .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
      );
      expect(fake.seen).toEqual([{ method: 'POST', path: CREATE_PATH }]);
      expect(fake.bodies[0]).toMatchObject({ password: 's3cret', repo: REPO });
    } finally {
      delete process.env[ENV_VAR];
    }
  });

  test('create refuses with a typed error when the ref is unset — and never sends', async () => {
    const fake = fakeArgocd(() => fakeFailure(500, 'should not be reached'));
    const failure = await Effect.runPromise(
      Effect.flip(
        spec
          .create({ ...props, passwordEnv: 'DEFINITELY_UNSET_ARGOCD_REPO_XYZ' })
          .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
      ),
    );
    expect(failure).toBeInstanceOf(ArgoCDSecretRefUnsetError);
    expect(fake.seen).toEqual([]);
  });
});

describe('reconcile / destroy', () => {
  const ops = argocdOperations(spec);

  test('declaring exactly what is live sends no write', async () => {
    const fake = fakeArgocd((method, url) =>
      method === 'GET' && url.pathname === REPO_PATH
        ? Response.json(liveJson)
        : fakeFailure(500, 'should not write'),
    );
    await Effect.runPromise(ops.reconcile(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))));
    expect(fake.seen.every((row) => row.method === 'GET')).toBe(true);
  });

  test('destroying an absent repo sends no DELETE', async () => {
    const fake = fakeArgocd(() => fakeFailure(404, 'not found'));
    await Effect.runPromise(ops.destroy(props).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))));
    expect(fake.seen).toEqual([{ method: 'GET', path: REPO_PATH }]);
  });
});
