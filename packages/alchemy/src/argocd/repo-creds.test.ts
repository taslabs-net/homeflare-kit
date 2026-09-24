/**
 * `Argocd.RepoCreds`'s `spec` against a fake Argo CD.
 *
 * ⚠️ THERE IS NO GET-BY-URL OPERATION (see `repo-creds.ts`'s header) — `fetchLive` lists and
 *   finds, so the tests here cover "found in the list", "absent from a non-empty list" AND
 *   "empty list", not just a single not-found case.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_BASE, fakeArgocd, fakeArgocdLayer, fakeFailure } from './fake-argocd.ts';
import { argocdOperations } from './resource.ts';
import { spec } from './repo-creds.ts';

const URL_PREFIX = `${FAKE_BASE}/homeflare/`;
const ENV_VAR = 'ARGOCD_REPOCREDS_HOMEFLARE_SSH_KEY';

const listWith = (...items: Record<string, unknown>[]) => Response.json({ items });

describe('Argocd.RepoCreds spec.fetchLive (list + find, no single Get)', () => {
  test('finds a matching entry in a non-empty list', async () => {
    const fake = fakeArgocd(() =>
      listWith(
        { type: 'git', url: URL_PREFIX, username: 'ci' },
        { type: 'git', url: `${FAKE_BASE}/other/` },
      ),
    );
    const live = await Effect.runPromise(
      spec.fetchLive({ url: URL_PREFIX }).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(live?.username).toBe('ci');
  });

  test('an empty list is undefined', async () => {
    const fake = fakeArgocd(() => listWith());
    const result = await Effect.runPromise(
      spec.fetchLive({ url: URL_PREFIX }).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(result).toBeUndefined();
  });

  test('a non-empty list with no matching url is undefined', async () => {
    const fake = fakeArgocd(() => listWith({ type: 'git', url: `${FAKE_BASE}/other/` }));
    const result = await Effect.runPromise(
      spec.fetchLive({ url: URL_PREFIX }).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(result).toBeUndefined();
  });

  test('a 401 propagates — not folded to absent', async () => {
    const fake = fakeArgocd(() => fakeFailure(401, 'bad token'));
    const failure = await Effect.runPromise(
      Effect.flip(
        spec.fetchLive({ url: URL_PREFIX }).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('Unauthorized');
  });
});

describe('Argocd.RepoCreds destroy — idempotent (S11)', () => {
  test('deleting an absent template makes no DELETE call', async () => {
    const fake = fakeArgocd(() => listWith());
    await Effect.runPromise(
      argocdOperations(spec)
        .destroy({ url: URL_PREFIX })
        .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(fake.seen.every((call) => call.method !== 'DELETE')).toBe(true);
  });
});

describe('Argocd.RepoCreds spec.upsert — write-only credentials', () => {
  beforeEach(() => {
    delete process.env[ENV_VAR];
  });
  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  test('refuses with a typed domain error when the declared env var is unset', async () => {
    const fake = fakeArgocd(() => listWith());
    const failure = await Effect.runPromise(
      Effect.flip(
        spec
          .upsert({ credentials: { sshPrivateKey: { fromEnv: ENV_VAR } }, url: URL_PREFIX })
          .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('ArgocdSecretEnvUnsetError');
    expect(fake.seen).toEqual([]);
  });

  test('resolves the env var and sends it in the body, with upsert=true on the query string', async () => {
    process.env[ENV_VAR] = '-----BEGIN KEY-----fake-----END KEY-----';
    const fake = fakeArgocd((method) =>
      method === 'POST' ? Response.json({ url: URL_PREFIX }) : fakeFailure(404, 'x'),
    );
    await Effect.runPromise(
      spec
        .upsert({ credentials: { sshPrivateKey: { fromEnv: ENV_VAR } }, url: URL_PREFIX })
        .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    const [create] = fake.seen.filter((call) => call.method === 'POST');
    expect(create?.path).toContain('upsert=true');
    const body = create?.body as Record<string, unknown>;
    expect(body.sshPrivateKey).toBe('-----BEGIN KEY-----fake-----END KEY-----');
    expect(JSON.stringify(body)).not.toContain('fromEnv');
  });
});
