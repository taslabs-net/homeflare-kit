/**
 * The guards `LiteLLM.Credential` adds on top of the typed SDK calls, tested at the handler level
 * (a value is in the request body of `POST /credentials`, so a create that dies on the wire, or one
 * made while the SDK's debug printing is on, would put it where nobody should see it) and through
 * Alchemy's real Plan and Apply (a rename onto a row another owner holds must be refused, not
 * overwritten).
 *
 * ★ EVERY VALUE IS `FAKE-*`, and a test that asserts a value is absent needs a value it can search
 *   for: `FAKE-key-one` is the credential value the declaration resolves from `process.env`.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { credentials } from '@distilled.cloud/litellm/Credentials';
import { Retry } from '@distilled.cloud/litellm/Retry';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Logger from 'effect/Logger';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import { credentialHandlers } from './credential.ts';
import type { CredentialProps } from './credential-types.ts';
import { resolveValues, sealValues } from './credential-values.ts';
import { credentialRow, startFakeCredentialLitellm } from './fake-credential-litellm.ts';
import { FAKE_BASE } from './fake-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMCredential } from './credential.ts';

const KEY = 'sk-test-master';
const VARIABLE = 'FAKE_CREDENTIAL_GUARD_KEY';
const VALUE = 'FAKE-key-one';

const props: CredentialProps = {
  credentialInfo: { note: 'docs search' },
  credentialName: 'FAKE_api',
  credentialValues: { api_key: { fromEnv: VARIABLE } },
};

beforeEach(() => {
  process.env[VARIABLE] = VALUE;
});
afterEach(() => {
  delete process.env[VARIABLE];
  delete process.env.DISTILLED_DEBUG_HTTP;
});

type Fake = ReturnType<typeof startFakeCredentialLitellm>;

/** One reconcile effect at the handler level, against the fake, with the SDK's retry OFF. */
const reconcileEffect = (
  fake: Fake,
  news: CredentialProps,
  output: Parameters<typeof credentialHandlers.reconcile>[0]['output'] = undefined,
) =>
  credentialHandlers
    .reconcile({ fqn: 'Cred', instanceId: 'i-1', news, output })
    .pipe(
      Effect.provideService(Retry, { while: () => false }),
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fake.fetch)),
      Effect.provide(credentials({ apiKey: KEY, baseUrl: FAKE_BASE })),
    ) as Effect.Effect<unknown, unknown, never>;

/** Runs the reconcile to a value, or the failure it raised. */
const runReconcile = (fake: Fake, news: CredentialProps): Promise<unknown> =>
  Effect.runPromise(Effect.flip(reconcileEffect(fake, news)));

/** A fake whose `POST /credentials` drops the connection before any answer. */
const droppedCreate = (fake: Fake): Fake => ({
  ...fake,
  fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/credentials' && request.method === 'POST') {
      throw new TypeError('fetch failed');
    }
    return fake.fetch(input, init);
  }) as typeof globalThis.fetch,
});

/** A fake whose `PATCH /credentials/{name}` drops the connection before any answer. */
const droppedPatch = (fake: Fake): Fake => ({
  ...fake,
  fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (request.method === 'PATCH' && new URL(request.url).pathname.startsWith('/credentials/')) {
      const body = (await request.json()) as Record<string, unknown>;
      expect(Object.keys((body.credential_values ?? {}) as object)).toEqual(['api_key']);
      throw new TypeError('fetch failed');
    }
    return fake.fetch(input, init);
  }) as typeof globalThis.fetch,
});

/** What Effect's JSON logger prints for the value. */
const jsonLogged = async (value: unknown): Promise<string> => {
  const lines: string[] = [];
  const capture = Logger.make((options) => void lines.push(Logger.formatJson.log(options)));
  await Effect.runPromise(
    Effect.logError('create failed', value).pipe(Effect.provide(Logger.layer([capture]))),
  );
  return lines.join('\n');
};

/** Every reading of `value` a caller could take: serialise, inspect, print, log. */
const everyReadingOf = async (value: unknown): Promise<string> => {
  const readings = [Bun.inspect(value, { depth: 12 }), String(value), await jsonLogged(value)];
  try {
    readings.push(JSON.stringify(value));
  } catch {
    /* a value JSON cannot serialise leaks nothing that way */
  }
  if (typeof value === 'object' && value !== null && 'message' in value) {
    readings.push(String(value.message), 'stack' in value ? String(value.stack) : '');
  }
  return readings.join('\n');
};

describe('a rename onto a row another owner holds', () => {
  test('is refused at apply, the foreign row untouched, nothing written', async () => {
    const fake = startFakeCredentialLitellm({
      masterKey: KEY,
      seed: [
        credentialRow({
          credential_info: { note: 'another owner' },
          credential_name: 'FAKE_api2',
          credential_values: { api_key: 'FAKE-elsewhere' },
        }),
      ],
    });
    const engine = fakeStack({ apiKey: KEY, baseUrl: FAKE_BASE }, fake.fetch);
    const declare = (p: CredentialProps) =>
      Effect.gen(function* () {
        yield* LiteLLMCredential('Cred', p);
      });
    // Own `FAKE_api` first, then rename onto the seeded `FAKE_api2`.
    await engine.deploy(declare(props));
    const before = fake.requests().length;
    await expect(engine.deploy(declare({ ...props, credentialName: 'FAKE_api2' }))).rejects.toThrow(
      /already exists/,
    );
    expect(writesOf(fake.requests().slice(before))).toEqual([]);
    expect(fake.rows().find((row) => row['credential_name'] === 'FAKE_api2')).toMatchObject({
      credential_info: { note: 'another owner' },
      credential_values: { api_key: 'FAKE-elsewhere' },
    });
  });

  test('is refused even under --adopt (a replace is never probed for adoption)', async () => {
    const fake = startFakeCredentialLitellm({
      masterKey: KEY,
      seed: [credentialRow({ credential_name: 'FAKE_api2', credential_values: { api_key: 'x' } })],
    });
    const engine = fakeStack({ apiKey: KEY, baseUrl: FAKE_BASE }, fake.fetch);
    const declare = (p: CredentialProps) =>
      Effect.gen(function* () {
        yield* LiteLLMCredential('Cred', p);
      });
    await engine.deploy(declare(props));
    const before = fake.requests().length;
    await expect(
      engine.deploy(declare({ ...props, credentialName: 'FAKE_api2' }), { adopt: true }),
    ).rejects.toThrow(/--adopt does not cover/);
    expect(writesOf(fake.requests().slice(before))).toEqual([]);
  });
});

describe('a create that dies on the wire', () => {
  test('fails typed, names the credential, and holds no request and no value', async () => {
    const fake = droppedCreate(startFakeCredentialLitellm({ masterKey: KEY }));
    const error = await runReconcile(fake, props);
    expect(error).toMatchObject({
      _tag: 'LitellmCredentialTransportError',
      credentialName: 'FAKE_api',
      reason: 'TransportError',
    });
    expect(Object.keys(error as object)).not.toContain('request');
    expect(Object.keys(error as object)).not.toContain('cause');
    expect(await everyReadingOf(error)).not.toContain(VALUE);
  });
});

describe('an update that dies on the wire', () => {
  test('leaves the row in place, fails typed, holds no value', async () => {
    // The owned row has a stale seal: this failing PATCH MUST carry credential values.
    const fake = droppedPatch(
      startFakeCredentialLitellm({
        masterKey: KEY,
        seed: [
          credentialRow({
            credential_info: { note: 'docs search' },
            credential_name: 'FAKE_api',
            credential_values: { api_key: VALUE },
          }),
        ],
      }),
    );
    const sealed = sealValues(resolveValues(props).values);
    process.env[VARIABLE] = 'FAKE-key-rotated';
    const error = await Effect.runPromise(
      Effect.flip(
        reconcileEffect(fake, props, {
          credentialInfo: { note: 'docs search' },
          credentialName: 'FAKE_api',
          valuesSeal: sealed,
        }),
      ),
    );
    expect(error).toMatchObject({
      _tag: 'LitellmCredentialTransportError',
      credentialName: 'FAKE_api',
      reason: 'TransportError',
    });
    expect(Object.keys(error as object)).not.toContain('request');
    expect(await everyReadingOf(error)).not.toContain('FAKE-key-rotated');
    // ★ finding 3: a PATCH that dies leaves the row it was merging into — the old DELETE + POST
    //   rewrite left NO row when the POST failed after the DELETE.
    expect(fake.rows()).toHaveLength(1);
    expect(fake.rows()[0]?.['credential_info']).toEqual({ note: 'docs search' });
    expect(fake.rows()[0]?.['credential_values']).toEqual({ api_key: VALUE });
  });
});

describe('a create while the SDK prints bodies', () => {
  test('is refused before any request, naming the credential', async () => {
    process.env.DISTILLED_DEBUG_HTTP = '1';
    const fake = startFakeCredentialLitellm({ masterKey: KEY });
    const error = await runReconcile(fake, props);
    expect(error).toMatchObject({
      _tag: 'LitellmCredentialDebugLoggingError',
      credentialName: 'FAKE_api',
    });
    // Refuse at the top of reconcile: even a read can expose unmasked non-sensitive values.
    expect(writesOf(fake.requests())).toEqual([]);
  });
});

describe('an absent credential is caught as absence, never a failure', () => {
  test('reconcile of a create with no live row converges (the read 404 is CredentialNotFound)', async () => {
    const fake = startFakeCredentialLitellm({ masterKey: KEY });
    const result = await Effect.runPromise(reconcileEffect(fake, props));
    expect(result).toMatchObject({ credentialName: 'FAKE_api' });
    expect(writesOf(fake.requests())).toEqual(['POST /credentials']);
  });
});
