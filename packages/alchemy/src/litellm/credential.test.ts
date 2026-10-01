/**
 * `LiteLLM.Credential` through Alchemy's real Plan and Apply over the fake proxy
 * (`fake-credential-litellm.ts`): create, no-op, the PATCH merge, the whole-row rewrite to drop a
 * key, adoption, the masked store's asymmetry, removal.
 *
 * ★ EVERY VALUE IS `FAKE-*`, and the credential reaches the resource only through an environment
 *   variable the test sets and removes, exactly as a deploying process would (S25).
 * ★ WHAT THE FAKE MODELS IS MEASURED FROM THE LIVE 1.103.0 CONTAINER (its header); the one
 *   unmeasured choice is `rows()` answering values in CLEAR, so a test can assert what a write SENT.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import { type CredentialProps, LiteLLMCredential } from './credential.ts';
import { credentialRow, startFakeCredentialLitellm } from './fake-credential-litellm.ts';
import { FAKE_BASE } from './fake-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';

const KEY = 'sk-test-master';
const VARIABLE = 'FAKE_CREDENTIAL_KEY';

const stack = (fake: ReturnType<typeof startFakeCredentialLitellm>) =>
  fakeStack({ apiKey: KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: CredentialProps, name = 'Cred') =>
  Effect.gen(function* () {
    yield* LiteLLMCredential(name, props);
  });

const props: CredentialProps = {
  credentialInfo: { note: 'docs search' },
  credentialName: 'FAKE_api',
  credentialValues: { api_key: { fromEnv: VARIABLE } },
};

beforeEach(() => {
  process.env[VARIABLE] = 'FAKE-key-one';
});
afterEach(() => {
  delete process.env[VARIABLE];
});

test('creates one row: the whole body in a single POST, the name in the body, values as literals', async () => {
  const fake = startFakeCredentialLitellm({ masterKey: KEY });
  expect(await stack(fake).deploy(declare(props))).toEqual({ Cred: 'create' });
  expect(fake.bodies()[0]).toEqual({
    credential_info: { note: 'docs search' },
    credential_name: 'FAKE_api',
    credential_values: { api_key: 'FAKE-key-one' },
  });
  expect(writesOf(fake.requests())).toEqual(['POST /credentials']);
});

test('a second deploy of the same declaration writes nothing', async () => {
  const fake = startFakeCredentialLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(props));
  const before = fake.requests().length;
  expect(await same.deploy(declare(props))).toEqual({ Cred: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('a rotated value is a PATCH merge — one row, then a no-op', async () => {
  const fake = startFakeCredentialLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(props));
  process.env[VARIABLE] = 'FAKE-key-two';
  const before = fake.requests().length;
  expect(await same.deploy(declare(props))).toEqual({ Cred: 'update' });
  expect(writesOf(fake.requests().slice(before))).toEqual(['PATCH /credentials/FAKE_api']);
  expect(fake.rows()).toHaveLength(1);
  expect(fake.rows()[0]?.['credential_values']).toEqual({ api_key: 'FAKE-key-two' });
  expect(await same.deploy(declare(props))).toEqual({ Cred: 'noop' });
});

test('a changed metadata value is a PATCH too', async () => {
  const fake = startFakeCredentialLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(props));
  expect(
    await same.deploy(declare({ ...props, credentialInfo: { note: 'docs search v2' } })),
  ).toEqual({ Cred: 'update' });
  expect(writesOf(fake.requests())).toEqual(['POST /credentials', 'PATCH /credentials/FAKE_api']);
  expect(fake.rows()[0]?.['credential_info']).toEqual({ note: 'docs search v2' });
});

test('dropping a previously-declared info key is a whole-row rewrite (PATCH cannot remove)', async () => {
  const fake = startFakeCredentialLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare({ ...props, credentialInfo: { note: 'docs search', team: 'a' } }));
  const before = fake.requests().length;
  expect(await same.deploy(declare(props))).toEqual({ Cred: 'update' });
  expect(writesOf(fake.requests().slice(before))).toEqual([
    'DELETE /credentials/FAKE_api',
    'POST /credentials',
  ]);
  expect(fake.rows()[0]?.['credential_info']).toEqual({ note: 'docs search' });
});

test('a live row is Unowned: refused without --adopt, taken with it (and sealed)', async () => {
  const seed = [
    credentialRow({
      credential_info: { note: 'docs search' },
      credential_name: 'FAKE_api',
      credential_values: { api_key: 'FAKE-key-rotated-elsewhere' },
    }),
  ];
  const fake = startFakeCredentialLitellm({ masterKey: KEY, seed });
  const engine = stack(fake);
  await expect(engine.deploy(declare(props))).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
  await engine.deploy(declare(props), { adopt: true });
  // the declared values are stamped over the row a writer elsewhere rotated, so the seal matches
  expect(writesOf(fake.requests())).toEqual(['PATCH /credentials/FAKE_api']);
  expect(fake.rows()[0]?.['credential_values']).toEqual({ api_key: 'FAKE-key-one' });
  const before = fake.requests().length;
  expect(await engine.deploy(declare(props))).toEqual({ Cred: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('adopting with the variable unset writes nothing and demands nothing; a later deploy writes', async () => {
  const seed = [
    credentialRow({
      credential_info: { note: 'docs search' },
      credential_name: 'FAKE_api',
      credential_values: { api_key: 'FAKE-key-elsewhere' },
    }),
  ];
  const fake = startFakeCredentialLitellm({ masterKey: KEY, seed });
  const engine = stack(fake);
  delete process.env[VARIABLE];
  await engine.deploy(declare(props), { adopt: true });
  expect(writesOf(fake.requests())).toEqual([]);
  process.env[VARIABLE] = 'FAKE-key-two';
  expect(await engine.deploy(declare(props))).toEqual({ Cred: 'update' });
  expect(fake.rows()[0]?.['credential_values']).toEqual({ api_key: 'FAKE-key-two' });
});

test('a row the proxy holds only in its database (not loaded in memory) fails the deploy loudly', async () => {
  const fake = startFakeCredentialLitellm({
    masterKey: KEY,
    memoryOmits: ['FAKE_api'],
    seed: [
      credentialRow({
        credential_info: { note: 'docs search' },
        credential_name: 'FAKE_api',
        credential_values: { api_key: 'FAKE-key-elsewhere' },
      }),
    ],
  });
  // the read answers 404, the create for the same name answers 409 — never a silent success
  await expect(stack(fake).deploy(declare(props))).rejects.toThrow();
  expect(fake.rows()).toHaveLength(1);
});

test('a literal value in the declaration is refused before a single request', async () => {
  const fake = startFakeCredentialLitellm({ masterKey: KEY });
  const literal = {
    ...props,
    credentialValues: { api_key: { value: 'FAKE-literal' } as never },
  };
  await expect(stack(fake).deploy(declare(literal))).rejects.toThrow();
  expect(fake.requests()).toEqual([]);
});

test('a sensitive-keyed metadata entry is refused before a single request', async () => {
  const fake = startFakeCredentialLitellm({ masterKey: KEY });
  const sensitive = { ...props, credentialInfo: { authToken: 'FAKE-meta' } };
  await expect(stack(fake).deploy(declare(sensitive))).rejects.toThrow();
  expect(fake.requests()).toEqual([]);
});

test('a renamed credential is a replace, and the old row is retained', async () => {
  const fake = startFakeCredentialLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(props));
  expect(await same.deploy(declare({ ...props, credentialName: 'FAKE_api2' }))).toEqual({
    Cred: 'replace',
  });
  expect(fake.rows().map((row) => row['credential_name'])).toEqual(['FAKE_api', 'FAKE_api2']);
});

test('under RemovalPolicy.destroy() a removed declaration deletes the row; the default retains it', async () => {
  const fake = startFakeCredentialLitellm({ masterKey: KEY });
  const engine = stack(fake);
  const gone = Effect.gen(function* () {
    yield* LiteLLMCredential('Gone', props).pipe(RemovalPolicy.destroy());
  });
  await engine.deploy(gone);
  expect(await engine.deploy(Effect.void)).toEqual({ Gone: 'delete' });
  expect(fake.rows()).toEqual([]);

  await engine.deploy(declare(props, 'Kept'));
  await engine.deploy(Effect.void);
  expect(fake.rows()).toHaveLength(1);
});

test('a create whose variable is unset is refused at the write, names the variable, writes nothing', async () => {
  const fake = startFakeCredentialLitellm({ masterKey: KEY });
  delete process.env[VARIABLE];
  const failure = await stack(fake)
    .deploy(declare(props))
    .then(
      () => undefined,
      (error: unknown) => String(error),
    );
  expect(failure).toContain(VARIABLE);
  expect(writesOf(fake.requests())).toEqual([]);
});

test('an unset variable on an unchanged row is "cannot tell", never drift', async () => {
  const fake = startFakeCredentialLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(props));
  delete process.env[VARIABLE];
  const before = fake.requests().length;
  expect(await same.deploy(declare(props))).toEqual({ Cred: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});
