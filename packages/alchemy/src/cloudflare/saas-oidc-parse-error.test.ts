/**
 * A response the SDK cannot validate must not carry the client secret out of this package.
 *
 * ⛔ THE LEAK THIS PINS. Under STRICT response validation, `@distilled.cloud/cloudflare@1.0.0-rc.13`
 *   fails a 2xx response it cannot decode with `CloudflareParseError({ body, cause })`, `body` being
 *   the WHOLE parsed response (protocol.ts:452-457). For a confidential client a create response
 *   carries `client_secret`, so a raw SDK error that reached a log or a trace would print it.
 *   `fake-access.ts` plants `FAKE_CLIENT_SECRET` in a body the decoder rejects, for each call.
 * ★ THE FIRST TEST IS THE PREMISE: the raw SDK error really does carry the secret under the strict
 *   switch `strict` provides, so a renamed key or a lenient default fails there, not silently below.
 */
import { describe, expect, spyOn, test } from 'bun:test';
import { CloudflareParseError } from '@distilled.cloud/cloudflare/Errors';
import * as zeroTrust from '@distilled.cloud/cloudflare/zero-trust';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import { FAKE_CLIENT_SECRET, fakeAccess } from './fake-access.ts';
import { FAKE_ACCOUNT, fakeClientLayer } from './fake-mesh.ts';
import { deleteSaasOidc } from './saas-oidc-lifecycle.ts';
import { sdkWrites } from './saas-oidc-api.ts';
import { LIVE_OIDC, publicClient, reconcile, run, strict } from './saas-oidc-harness.ts';

/** Run `go` with the console watched; the second member is everything it logged. */
const watched = async <T>(go: () => Promise<T>): Promise<readonly [T, string]> => {
  const spies = [spyOn(console, 'log'), spyOn(console, 'error'), spyOn(console, 'warn')];
  try {
    const result = await go();
    return [result, JSON.stringify(spies.map((spy) => spy.mock.calls))];
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
};

/** Everything a caller or a log could render from a failure: nothing may hold the secret. */
const surfaces = (exit: Exit.Exit<unknown, unknown>, logged: string): string[] => {
  if (!Exit.isFailure(exit)) throw new Error('expected a failure');
  const error = Cause.squash(exit.cause);
  const fields = (error instanceof Error ? Object.getOwnPropertyNames(error) : []).map(
    (key) => (error as unknown as Record<string, unknown>)[key],
  );
  return [
    String(error),
    JSON.stringify(error),
    JSON.stringify(fields),
    error instanceof Error ? error.message : '',
    Cause.pretty(exit.cause),
    logged,
  ];
};

const failureOf = (exit: Exit.Exit<unknown, unknown>): { _tag: string; message: string } => {
  if (!Exit.isFailure(exit)) throw new Error('expected a failure');
  return Cause.squash(exit.cause) as { _tag: string; message: string };
};

type Outcome = Promise<Exit.Exit<unknown, unknown>>;

/**
 * The error rc.13 builds (protocol.ts:452-457) for a create that answered with a secret: the whole
 * envelope as `body`, a SchemaError-like `cause` quoting the offending value.
 */
const rawParseError = () =>
  new CloudflareParseError({
    body: { success: true, result: { id: 'app', saas_app: { client_secret: FAKE_CLIENT_SECRET } } },
    cause: `Expected string, actual ${FAKE_CLIENT_SECRET}`,
  });

/** Stand in for one SDK write that fails with the raw parse error, then put the real ones back. */
const withRawWrite = async (which: 'create' | 'update', go: () => Outcome): Outcome => {
  const real = { ...sdkWrites };
  Object.assign(sdkWrites, { [which]: () => Effect.fail(rawParseError()) });
  try {
    return await go();
  } finally {
    Object.assign(sdkWrites, real);
  }
};

/**
 * One way to make each call fail with CloudflareParseError, and what the sanitized error names.
 * ⚠️ create and update go through `sdkWrites` because rc.13 cannot be made to fail them (their
 *   response decodes against `S.Unknown`, see saas-oidc-error.ts); the other three are the REAL SDK
 *   under strict validation, fed a body its typed schema rejects.
 */
const scenarios: ReadonlyArray<readonly [string, string, () => Outcome]> = [
  [
    'create',
    'application create',
    () =>
      withRawWrite('create', () =>
        run(fakeAccess(), (p) => Effect.exit(reconcile(p, publicClient()))),
      ),
  ],
  [
    'update',
    'application update',
    () => {
      const fake = fakeAccess();
      const live = fake.seed({ name: 'Headlamp', policies: ['policy-old'], saas_app: LIVE_OIDC });
      return withRawWrite('update', () =>
        run(fake, (p) => Effect.exit(reconcile(p, publicClient({ applicationId: live.id })))),
      );
    },
  ],
  [
    'list',
    'application list',
    () =>
      run(fakeAccess({ malformed: ['list'] }), (p) =>
        Effect.exit(strict(reconcile(p, publicClient()))),
      ),
  ],
  [
    'org',
    'organization read',
    () =>
      run(fakeAccess({ malformed: ['org'] }), (p) =>
        Effect.exit(strict(reconcile(p, publicClient()))),
      ),
  ],
  [
    'delete',
    'application delete',
    async () => {
      const fake = fakeAccess({ malformed: ['delete'] });
      const made = await run(fake, (p) => reconcile(p, publicClient()));
      return Effect.runPromiseExit(
        strict(deleteSaasOidc(made)).pipe(Effect.provide(fakeClientLayer(fake))),
      );
    },
  ],
];

describe('a response the SDK cannot validate', () => {
  test('premise: the real SDK raises CloudflareParseError carrying the whole response', async () => {
    const fake = fakeAccess({ malformed: ['delete'] });
    const made = await run(fake, (p) => reconcile(p, publicClient()));
    const raw = await Effect.runPromise(
      strict(
        zeroTrust.deleteAccessApplicationForAccount({
          accountId: FAKE_ACCOUNT,
          appId: made.applicationId,
        }),
      ).pipe(Effect.flip, Effect.provide(fakeClientLayer(fake))),
    );
    expect(raw).toMatchObject({
      _tag: 'CloudflareParseError',
      body: { result: { client_secret: FAKE_CLIENT_SECRET } },
    });
  });

  test.each(scenarios)(
    '%s: only the operation is named, never a body or a field',
    async (_op, name, go) => {
      const [exit, logged] = await watched(go);
      const error = failureOf(exit);
      expect(error._tag).toBe('SaasOidcError');
      expect(error.message).toContain(name);
      expect(error.message).toContain('withheld');
      for (const surface of surfaces(exit, logged)) {
        expect(surface).not.toContain(FAKE_CLIENT_SECRET);
        expect(surface).not.toContain('client_secret');
      }
    },
  );

  test('the seam leaves the real SDK in place afterwards', () => {
    expect(sdkWrites.create).toBe(zeroTrust.createAccessApplicationForAccount);
    expect(sdkWrites.update).toBe(zeroTrust.updateAccessApplicationForAccount);
  });

  test('the raw read (not an SDK call) fails on a non-JSON body without echoing it', async () => {
    const [exit, logged] = await watched(() =>
      run(fakeAccess({ malformed: ['get'] }), (p) => Effect.exit(reconcile(p, publicClient()))),
    );
    expect(failureOf(exit).message).toContain('was not JSON');
    for (const surface of surfaces(exit, logged)) expect(surface).not.toContain(FAKE_CLIENT_SECRET);
  });
});
