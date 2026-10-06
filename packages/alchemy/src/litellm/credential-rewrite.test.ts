/** Removal needs both LiteLLM stores to converge; preflight must finish before DELETE. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { credentials } from '@distilled.cloud/litellm/Credentials';
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import { type CredentialProps, LiteLLMCredential, credentialHandlers } from './credential.ts';
import { credentialRow, startFakeCredentialLitellm } from './fake-credential-litellm.ts';
import { FAKE_BASE } from './fake-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';

const variable = 'FAKE_REWRITE_KEY';
const creds = { apiKey: 'FAKE-master', baseUrl: FAKE_BASE };
const props: CredentialProps = {
  credentialName: 'FAKE_api',
  credentialInfo: { note: 'search' },
  credentialValues: { api_key: { fromEnv: variable } },
};
const declare = (news: CredentialProps) =>
  Effect.gen(function* () {
    yield* LiteLLMCredential('Cred', news);
  });
const extraValues = {
  ...props,
  credentialValues: {
    ...props.credentialValues,
    api_base: { fromEnv: variable },
  },
};
const extraInfo = { ...props, credentialInfo: { ...props.credentialInfo, team: 'a' } };
const setup = () => {
  const fake = startFakeCredentialLitellm({ masterKey: creds.apiKey });
  return { fake, engine: fakeStack(creds, fake.fetch) };
};
beforeEach(() => {
  process.env[variable] = 'FAKE-rewrite-value';
});
afterEach(() => {
  delete process.env[variable];
  delete process.env.DISTILLED_DEBUG_HTTP;
});

test('dropping a value key rewrites the row, removes it from DB and memory, then noops', async () => {
  const { fake, engine } = setup();
  await engine.deploy(declare(extraValues));
  const before = fake.requests().length;
  expect(await engine.deploy(declare(props))).toEqual({ Cred: 'update' });
  expect(writesOf(fake.requests().slice(before))).toEqual([
    'DELETE /credentials/FAKE_api',
    'POST /credentials',
  ]);
  expect(Object.keys(fake.rows()[0]?.credential_values as object)).toEqual(['api_key']);
  expect(await engine.deploy(declare(props))).toEqual({ Cred: 'noop' });
  expect(engine.snapshot().includes('FAKE-rewrite-value')).toBe(false);
});

for (const [kind, original] of [
  ['value', extraValues],
  ['info', extraInfo],
] as const) {
  test(`dropping a ${kind} key with a missing value refuses before DELETE`, async () => {
    const { fake, engine } = setup();
    await engine.deploy(declare(original));
    const before = fake.requests().length;
    delete process.env[variable];
    await expect(engine.deploy(declare(props))).rejects.toThrow(variable);
    expect(writesOf(fake.requests().slice(before))).toEqual([]);
    expect(fake.rows()).toHaveLength(1);
  });

  test(`dropping a ${kind} key under debug logging refuses before any reconcile request`, async () => {
    const { fake, engine } = setup();
    await engine.deploy(declare(original));
    // The refusal is before any observation or write, so even stale state cannot bypass it.
    const before = fake.requests().length;
    process.env.DISTILLED_DEBUG_HTTP = '1';
    const error = await Effect.runPromise(
      credentialHandlers
        .reconcile({
          fqn: 'Cred',
          instanceId: 'i-1',
          news: props,
          output: {
            credentialName: props.credentialName,
            credentialInfo: original.credentialInfo ?? {},
            valuesSeal: '',
          },
        })
        .pipe(
          Effect.catchTag('LitellmCredentialDebugLoggingError', (failure) =>
            Effect.succeed(failure._tag),
          ),
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(FetchHttpClient.Fetch, fake.fetch),
          Effect.provide(credentials(creds)),
        ),
    );
    expect(error).toBe('LitellmCredentialDebugLoggingError');
    expect(fake.requests()).toHaveLength(before);
    expect(fake.rows()).toHaveLength(1);
  });
}

test('adoption deliberately removes undeclared info keys, including withheld sensitive names', async () => {
  const fake = startFakeCredentialLitellm({
    masterKey: creds.apiKey,
    seed: [
      credentialRow({
        credential_name: props.credentialName,
        credential_info: { note: 'search', foreign: 'a', secret: 'FAKE-withheld' },
        credential_values: { api_key: 'FAKE-existing' },
      }),
    ],
  });
  const engine = fakeStack(creds, fake.fetch);
  await engine.deploy(declare(props), { adopt: true });
  expect(writesOf(fake.requests())).toEqual(['DELETE /credentials/FAKE_api', 'POST /credentials']);
  expect(Object.keys(fake.rows()[0]?.credential_info as object)).toEqual(['note']);
  expect(engine.snapshot().includes('FAKE-withheld')).toBe(false);
  expect(await engine.deploy(declare(props))).toEqual({ Cred: 'noop' });
});

test('PATCH records a complete intended info map and the required body name', async () => {
  const { fake, engine } = setup();
  await engine.deploy(declare(extraInfo));
  const news = { ...extraInfo, credentialInfo: { note: 'changed', team: 'a' } };
  await engine.deploy(declare(news));
  expect(fake.bodies()[1]?.credential_name).toBe(props.credentialName);
  expect(fake.bodies()[1]?.credential_info).toEqual(news.credentialInfo);
  expect(fake.rows()[0]?.credential_info).toEqual(news.credentialInfo);
  expect(await engine.deploy(declare(news))).toEqual({ Cred: 'noop' });
});

test('the fake rejects a PATCH with no body credential_name, matching UpdateCredentialItem', async () => {
  const { fake, engine } = setup();
  await engine.deploy(declare(props));
  const response = await fake.fetch(`${FAKE_BASE}/credentials/FAKE_api`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${creds.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ credential_info: { note: 'changed' } }),
  });
  expect(response.status).toBe(422);
  expect(fake.bodies()).toHaveLength(2);
  expect(fake.rows()[0]?.credential_info).toEqual(props.credentialInfo);
});

test('a debug-enabled plan refuses before the read response can print unmasked values', async () => {
  const { fake, engine } = setup();
  await engine.deploy(declare(extraValues));
  const before = fake.requests().length;
  const printed: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    printed.push(args.join(' '));
  };
  try {
    process.env.DISTILLED_DEBUG_HTTP = '1';
    await expect(engine.deploy(declare(props))).rejects.toThrow('DISTILLED_DEBUG_HTTP');
  } finally {
    console.error = original;
  }
  expect(printed.join('\n').includes('FAKE-rewrite-value')).toBe(false);
  expect(fake.requests()).toHaveLength(before);
  expect(fake.rows()).toHaveLength(1);
});
