/**
 * `Argocd.Repository`'s `spec` against a fake Argo CD — proves the doctrine-required shapes:
 *
 * - `fetchLive` folds a real distilled `NotFound` (404) to `undefined`, and does NOT fold a
 *   401 — the same `catchTag('NotFound', ...)` idiom `forgejo/repository.test.ts` proves.
 * - `spec.destroy`-via-`argocdOperations#destroy` is idempotent: a delete of an already-absent
 *   repository makes no request at all (S11).
 * - `spec.upsert` sends `upsert: true` and resolves write-only credentials from the environment,
 *   never a literal value on a stack file — and refuses (a typed domain error, not a distilled
 *   one) when the declared env var is unset.
 *
 * No live Argo CD instance exists on the estate (2026-09-24) — every assertion here runs against
 * `fake-argocd.ts`, never a real server.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_BASE, fakeArgocd, fakeArgocdLayer, fakeFailure } from './fake-argocd.ts';
import { argocdOperations } from './resource.ts';
import { spec } from './repository.ts';

const REPO = `${FAKE_BASE}/homeflare/kit.git`;
const ENV_VAR = 'ARGOCD_REPO_KIT_PASSWORD';

const liveRepo = (overrides: Record<string, unknown> = {}) =>
  Response.json({ enableLfs: true, repo: REPO, type: 'git', ...overrides });

describe('Argocd.Repository spec.fetchLive', () => {
  test('a live repository decodes into attributes', async () => {
    const fake = fakeArgocd((method) =>
      method === 'GET' ? liveRepo() : fakeFailure(404, 'not found'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive({ repo: REPO }).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(live?.repo).toBe(REPO);
    expect(live?.enableLfs).toBe(true);
  });

  test('a 404 folds to undefined', async () => {
    const fake = fakeArgocd(() => fakeFailure(404, 'repository not found'));
    const result = await Effect.runPromise(
      spec.fetchLive({ repo: REPO }).pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(result).toBeUndefined();
  });

  test('a 401 propagates — not folded to absent', async () => {
    const fake = fakeArgocd(() => fakeFailure(401, 'bad token'));
    const failure = await Effect.runPromise(
      Effect.flip(spec.fetchLive({ repo: REPO }).pipe(Effect.provide(fakeArgocdLayer(fake.fetch)))),
    );
    expect(failure._tag).toBe('Unauthorized');
  });
});

describe('Argocd.Repository destroy — idempotent (S11)', () => {
  test('deleting an already-absent repository makes no delete call', async () => {
    const fake = fakeArgocd(() => fakeFailure(404, 'repository not found'));
    await Effect.runPromise(
      argocdOperations(spec)
        .destroy({ repo: REPO })
        .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    // Only the read (fetchLive) happened — never a DELETE against an object that was never there.
    expect(fake.seen.every((call) => call.method !== 'DELETE')).toBe(true);
  });

  test('deleting a live repository calls DELETE once', async () => {
    const fake = fakeArgocd((method) => (method === 'GET' ? liveRepo() : Response.json({})));
    await Effect.runPromise(
      argocdOperations(spec)
        .destroy({ repo: REPO })
        .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(fake.seen.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });
});

describe('Argocd.Repository spec.upsert — write-only credentials', () => {
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
          .upsert({ credentials: { password: { fromEnv: ENV_VAR } }, repo: REPO, username: 'ci' })
          .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('ArgocdSecretEnvUnsetError');
    expect(fake.seen).toEqual([]);
  });

  test('resolves the env var and sends it — never the FromEnv reference itself', async () => {
    process.env[ENV_VAR] = 'hunter2';
    const fake = fakeArgocd((method) =>
      method === 'POST' ? Response.json({ repo: REPO }) : fakeFailure(404, 'x'),
    );
    await Effect.runPromise(
      spec
        .upsert({ credentials: { password: { fromEnv: ENV_VAR } }, repo: REPO, username: 'ci' })
        .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    const [create] = fake.seen.filter((call) => call.method === 'POST');
    // `upsert` is a query-string trait on this operation (`T.Query()`), not a body field —
    // measured against `CreateRepositoryServiceRepositoryRequest` in services/argocd.ts.
    expect(create?.path).toContain('upsert=true');
    const body = create?.body as Record<string, unknown>;
    expect(body.password).toBe('hunter2');
    expect(body.username).toBe('ci');
    expect(JSON.stringify(body)).not.toContain('fromEnv');
  });
});

describe('Argocd.Repository diff — a changed identity key is a replace, never an update', () => {
  // ⛔ REGRESSION: adversarial review 2026-09-24 found `diff` could only ever return
  //   noop/update, so a changed `repo` (Argo CD indexes by it) silently created a new
  //   registration at the new URL and left the old, still-credentialed one orphaned — no state
  //   pointed at it, nothing would ever delete it. Fixed via `identityOfProps`/
  //   `identityOfAttributes` in resource.ts.
  const RENAMED_REPO = `${FAKE_BASE}/homeflare/kit-renamed.git`;
  const oldOutput = spec.attributes({ enableLfs: true, repo: REPO, type: 'git' }, { repo: REPO });

  test('a changed repo URL is a replace, and no read of the new URL happens first', async () => {
    const fake = fakeArgocd(() => fakeFailure(500, 'must not be called — identity differs'));
    const result = await Effect.runPromise(
      argocdOperations(spec)
        .diff({ repo: RENAMED_REPO }, oldOutput)
        .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(result).toEqual({ action: 'replace' });
    expect(fake.seen).toEqual([]);
  });

  test('the SAME repo URL with a plain-field change is an update, not a replace', async () => {
    const fake = fakeArgocd((method) =>
      method === 'GET' ? liveRepo({ enableLfs: false }) : fakeFailure(404, 'x'),
    );
    const result = await Effect.runPromise(
      argocdOperations(spec)
        .diff({ enableLfs: true, repo: REPO }, oldOutput)
        .pipe(Effect.provide(fakeArgocdLayer(fake.fetch))),
    );
    expect(result).toEqual({ action: 'update' });
  });
});
