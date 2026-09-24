/**
 * `Argocd.Cluster`'s `spec` against a fake Argo CD — the same three doctrine-required shapes as
 * `repository.test.ts`, plus the nested `config.tlsClientConfig` credential path.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { fakeArgocd, fakeArgocdLayer, fakeFailure } from './fake-argocd.ts';
import { argocdOperations } from './resource.ts';
import { spec } from './cluster.ts';

const SERVER = 'https://talos.example.com:6443';
const ENV_VAR = 'ARGOCD_CLUSTER_TALOS_BEARER_TOKEN';

const liveCluster = (overrides: Record<string, unknown> = {}) =>
  Response.json({ name: 'talos', server: SERVER, ...overrides });

describe('Argocd.Cluster spec.fetchLive', () => {
  test('a live cluster decodes into attributes, including nested tls config', async () => {
    const fake = fakeArgocd((method) =>
      method === 'GET'
        ? liveCluster({
            config: { tlsClientConfig: { insecure: false, serverName: 'talos.internal' } },
          })
        : fakeFailure(404, 'not found'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive({ server: SERVER }).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(live?.server).toBe(SERVER);
    expect(live?.config?.tlsClientConfig?.serverName).toBe('talos.internal');
  });

  test('a 404 folds to undefined', async () => {
    const fake = fakeArgocd(() => fakeFailure(404, 'cluster not found'));
    const result = await Effect.runPromise(
      spec.fetchLive({ server: SERVER }).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(result).toBeUndefined();
  });

  test('a 403 propagates — not folded to absent', async () => {
    const fake = fakeArgocd(() => fakeFailure(403, 'forbidden'));
    const failure = await Effect.runPromise(
      Effect.flip(
        spec.fetchLive({ server: SERVER }).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('Forbidden');
  });
});

describe('Argocd.Cluster destroy — idempotent (S11)', () => {
  test('deleting an already-absent cluster makes no DELETE call', async () => {
    const fake = fakeArgocd(() => fakeFailure(404, 'cluster not found'));
    await Effect.runPromise(
      argocdOperations(spec)
        .destroy({ server: SERVER })
        .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(fake.seen.every((call) => call.method !== 'DELETE')).toBe(true);
  });

  test('the DELETE call itself returning 404 (a race with an external removal) still succeeds', async () => {
    // ⚠️ fetchLive's pre-check finds the cluster live, but something else deregisters it before
    //   this call's own DELETE lands — matching upstream's Hetzner/Certificate.ts `deleteById`.
    const fake = fakeArgocd((method) =>
      method === 'GET' ? liveCluster() : fakeFailure(404, 'cluster not found'),
    );
    await Effect.runPromise(
      argocdOperations(spec)
        .destroy({ server: SERVER })
        .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(fake.seen.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });
});

describe('Argocd.Cluster spec.upsert — write-only bearer token', () => {
  beforeEach(() => {
    delete process.env[ENV_VAR];
  });
  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  test('refuses with a typed domain error when the declared env var is unset', async () => {
    const fake = fakeArgocd(() => fakeFailure(404, 'unused'));
    const failure = await Effect.runPromise(
      Effect.flip(
        spec
          .upsert({ credentials: { bearerToken: { fromEnv: ENV_VAR } }, server: SERVER })
          .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('ArgocdClusterSecretEnvUnsetError');
    expect(fake.seen).toEqual([]);
  });

  test('resolves the bearer token into config, never the FromEnv reference itself', async () => {
    process.env[ENV_VAR] = 'kube-bearer-abc123';
    const fake = fakeArgocd((method) =>
      method === 'POST' ? Response.json({ server: SERVER }) : fakeFailure(404, 'x'),
    );
    await Effect.runPromise(
      spec
        .upsert({
          credentials: { bearerToken: { fromEnv: ENV_VAR } },
          namespaces: ['argocd', 'apps'],
          server: SERVER,
        })
        .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    const [create] = fake.seen.filter((call) => call.method === 'POST');
    expect(create?.path).toContain('upsert=true');
    const body = create?.body as { config?: { bearerToken?: string }; namespaces?: string[] };
    expect(body.config?.bearerToken).toBe('kube-bearer-abc123');
    expect(body.namespaces).toEqual(['argocd', 'apps']);
    expect(JSON.stringify(body)).not.toContain('fromEnv');
  });
});
