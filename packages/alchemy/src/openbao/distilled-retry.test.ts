import { expect, test } from 'bun:test';
import { policiesReadAclPolicy } from '@distilled.cloud/openbao/policies';
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import { HttpClientError, TransportError } from 'effect/unstable/http/HttpClientError';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import { readAuthRole, writeAuthRole } from './auth-role-wire.ts';
import { BaoEnv } from './bao-http.ts';
import { BaoError } from './bao-status.ts';
import { runBaoRead } from './distilled.ts';
import { deletePolicy, readPolicy, writePolicy } from './policy-wire.ts';

const ROLE_PROPS = {
  name: 'test',
  tokenPolicies: ['default'],
  tokenTtl: '15m',
  tokenMaxTtl: '1h',
  secretIdTtl: '2160h',
};

const TOKEN = 'fixture-retry-token';
const POLICY = { policy: 'path "test" {}' };
const ROLE = {
  bind_secret_id: true,
  secret_id_num_uses: 0,
  secret_id_ttl: 0,
  token_max_ttl: 3600,
  token_policies: ['default'],
  token_ttl: 900,
};

const runWith = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
  client: HttpClient.HttpClient,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(BaoEnv, { BAO_ADDR: 'http://fake.invalid', BAO_TOKEN: TOKEN }),
      Effect.provideService(HttpClient.HttpClient, client),
    ),
  );

for (const [name, read, data] of [
  ['Policy', Effect.asVoid(readPolicy('test')), POLICY],
  ['AppRole', Effect.asVoid(readAuthRole('test')), ROLE],
] as const) {
  test(`${name} retries a dropped read and then returns the live object`, async () => {
    let attempts = 0;
    const client = HttpClient.make((request) => {
      attempts++;
      expect(request.method).toBe('GET');
      return attempts === 1
        ? Effect.fail(new HttpClientError({ reason: new TransportError({ request }) }))
        : Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ data })));
    });
    await runWith(read, client);
    expect(attempts).toBe(2);
  });
}

test('read transport retries stop after three attempts without exposing the token', async () => {
  let attempts = 0;
  const client = HttpClient.make((request) => {
    attempts++;
    return Effect.fail(new HttpClientError({ reason: new TransportError({ request }) }));
  });
  const error = await runWith(Effect.flip(readPolicy('test')), client);
  expect(attempts).toBe(3);
  expect(error).toBeInstanceOf(BaoError);
  expect(JSON.stringify(error)).not.toContain(TOKEN);
});

/**
 * A FULL-REPLACE write sends the complete desired state on every attempt, so — unlike a
 * create or a non-idempotent call — it is safe to replay after a transport-level failure.
 * `runBaoWrite` restores the bounded retry `baoCall()` gave every call before the distilled
 * SDK path landed with `Retry.none`.
 */
for (const [name, write] of [
  ['Policy', writePolicy('test', 'path "test" {}')],
  ['AppRole', writeAuthRole(ROLE_PROPS)],
] as const) {
  test(`${name} write retries a dropped transport attempt and then succeeds`, async () => {
    let attempts = 0;
    const client = HttpClient.make((request) => {
      attempts++;
      expect(request.method).toBe('POST');
      return attempts === 1
        ? Effect.fail(new HttpClientError({ reason: new TransportError({ request }) }))
        : Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 204 })));
    });
    await runWith(write, client);
    expect(attempts).toBe(2);
  });

  test(`${name} write transport retries stop after three attempts without exposing the token`, async () => {
    let attempts = 0;
    const client = HttpClient.make((request) => {
      attempts++;
      return Effect.fail(new HttpClientError({ reason: new TransportError({ request }) }));
    });
    const error = await runWith(Effect.flip(write), client);
    expect(attempts).toBe(3);
    expect(error).toBeInstanceOf(BaoError);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });
}

test('a read timeout has a fresh bound on its next attempt', async () => {
  let attempts = 0;
  const client = HttpClient.make((request) => {
    attempts++;
    return attempts === 1
      ? Effect.never
      : Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ data: POLICY })));
  });
  await runWith(runBaoRead(policiesReadAclPolicy({ name: 'test' }), '20 millis'), client);
  expect(attempts).toBe(2);
});

/**
 * Delete stays single-attempt: it is idempotent (a policy or role already gone is success,
 * per policy-wire.ts / auth-role-wire.ts), but it is not a full-replace write, and this suite
 * scopes the restored retry to the writes that carry the complete desired state on the wire.
 */
test('an uncertain delete is never replayed', async () => {
  let attempts = 0;
  const client = HttpClient.make((request) => {
    attempts++;
    return Effect.fail(new HttpClientError({ reason: new TransportError({ request }) }));
  });
  const error = await runWith(Effect.flip(deletePolicy('test')), client);
  expect(error).toBeInstanceOf(BaoError);
  expect(attempts).toBe(1);
});

test('typed denied reads are returned immediately without transport retries', async () => {
  let attempts = 0;
  const client = HttpClient.make((request) => {
    attempts++;
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({ errors: ['permission denied'] }, { status: 403 }),
      ),
    );
  });
  const error = await runWith(Effect.flip(readPolicy('test')), client);
  expect(error).toMatchObject({ _tag: 'Forbidden' });
  expect(attempts).toBe(1);
});

test('SDK normalization accepts an address that already carries the API prefix', async () => {
  let observed = '';
  const client = HttpClient.make((request) => {
    observed = request.url;
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ data: POLICY })));
  });
  await runWith(
    readPolicy('test').pipe(Effect.provideService(BaoEnv, { BAO_ADDR: 'http://fake.invalid/v1/' })),
    client,
  );
  expect(observed).toBe('http://fake.invalid/v1/sys/policies/acl/test');
});
