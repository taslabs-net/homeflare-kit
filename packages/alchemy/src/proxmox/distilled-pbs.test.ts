/** The real PBS SDK protocol: correct credentials, bounded attempts, and no implicit re-send. */
import { expect, test } from 'bun:test';
import * as config from '@distilled.cloud/proxmox-backup/config';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type { PbsTarget, PveCredential } from './credentials.ts';
import { runPbsWith } from './distilled-pbs.ts';

const TARGET: PbsTarget = { api: 'https://pbs.invalid:8007', mount: 'pbs-test', scheme: 'pbs' };
const CREDENTIAL: PveCredential = {
  leaseSeconds: 300,
  secret: 'fake-secret-not-real',
  tokenId: 'test@pbs!fake',
};

const transport = (answer: (request: Request) => Response | Promise<Response>) => {
  const stub = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    Promise.resolve(
      answer(
        input instanceof Request ? new Request(input, init) : new Request(String(input), init),
      ),
    );
  return FetchHttpClient.layer.pipe(
    Layer.provideMerge(
      Layer.succeed(
        FetchHttpClient.Fetch,
        Object.assign(stub, { preconnect: globalThis.fetch.preconnect }),
      ),
    ),
  );
};

test('the PBS SDK builds its own colon-separated authorization and normalizes the API root', async () => {
  let called = false;
  const layer = transport((request) => {
    called = true;
    expect(request.url).toBe(
      'https://pbs.invalid:8007/api2/json/config/notifications/matchers/pager',
    );
    expect(request.headers.get('authorization')).toBe(
      'PBSAPIToken=test@pbs!fake:fake-secret-not-real',
    );
    return Response.json({ data: { name: 'pager', target: ['mail-to-root'] } });
  });
  const row = await Effect.runPromise(
    runPbsWith(TARGET, CREDENTIAL, config.getConfigNotificationMatcher({ name: 'pager' })).pipe(
      Effect.provide(layer),
    ),
  );
  expect(called).toBe(true);
  expect(row.target).toEqual(['mail-to-root']);
});

test('a typed HTTP failure is returned once, without the SDK default retry', async () => {
  let calls = 0;
  const layer = transport(() => {
    calls += 1;
    return Response.json({ message: 'unavailable' }, { status: 503 });
  });
  const error = await Effect.runPromise(
    runPbsWith(TARGET, CREDENTIAL, config.deleteConfigNotificationMatcher({ name: 'pager' })).pipe(
      Effect.flip,
      Effect.provide(layer),
    ),
  );
  expect(error).toMatchObject({ _tag: 'ServiceUnavailable' });
  expect(calls).toBe(1);
});

test('a sent write that never answers is bounded and never repeated', async () => {
  let calls = 0;
  const layer = transport(() => {
    calls += 1;
    return new Promise<Response>(() => {});
  });
  const error = await Effect.runPromise(
    runPbsWith(
      TARGET,
      CREDENTIAL,
      config.deleteConfigNotificationMatcher({ name: 'pager' }),
      '20 millis',
    ).pipe(Effect.flip, Effect.provide(layer)),
  );
  expect(error).toMatchObject({ _tag: 'TimeoutError' });
  expect(calls).toBe(1);
});
