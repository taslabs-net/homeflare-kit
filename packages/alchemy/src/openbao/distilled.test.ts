import { expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { policiesReadAclPolicy, policiesWriteAclPolicy } from '@distilled.cloud/openbao/policies';
import * as Effect from 'effect/Effect';
import * as Semaphore from 'effect/Semaphore';
import * as Headers from 'effect/unstable/http/Headers';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import { BaoEnv, BaoGate, MAX_IN_FLIGHT, baoRead } from './bao-http.ts';
import { runBao } from './distilled.ts';
import { fakeBao, run, runFailure, withFake } from './fake-bao.ts';
import { BaoError } from './bao-status.ts';
import { readPolicy } from './policy-wire.ts';

const OK = { json: { data: { policy: 'path "test" {}' } }, status: 200 };

test('SDK calls resolve BAO/VAULT values per call, retaining empty BAO precedence', async () => {
  await withFake(
    () => OK,
    async (bao) => {
      const env = {
        VAULT_ADDR: bao.address,
        VAULT_NAMESPACE: 'tenant',
        VAULT_TOKEN: 'first',
        BAO_TOKEN: '',
      };
      const read = readPolicy('test');
      await run(env, read);
      env.BAO_TOKEN = 'rotated';
      await run(env, read);
      expect(bao.seen[0]?.headers.has('x-vault-token')).toBe(false);
      expect(bao.seen[1]?.headers.get('x-vault-token')).toBe('rotated');
      expect(bao.seen[1]?.headers.get('x-vault-namespace')).toBe('tenant');
      expect(bao.seen[1]?.headers.get('x-vault-request')).toBe('true');
    },
  );
});

test('SDK calls use the agent unix socket ahead of a direct address, without a token header', async () => {
  const socket = join(tmpdir(), `distilled-bao-${process.pid}.sock`);
  rmSync(socket, { force: true });
  try {
    await withFake(
      () => OK,
      async (bao) => {
        await run(
          { BAO_ADDR: 'http://wrong.invalid', BAO_AGENT_ADDR: bao.address },
          readPolicy('test'),
        );
        expect(bao.seen[0]?.path).toBe('/v1/sys/policies/acl/test');
        expect(bao.seen[0]?.headers.has('x-vault-token')).toBe(false);
        expect(bao.seen[0]?.headers.has('x-vault-namespace')).toBe(false);
      },
      socket,
    );
  } finally {
    rmSync(socket, { force: true });
  }
});

test('legacy and SDK calls share the same eight in-flight permits', async () => {
  let active = 0;
  let peak = 0;
  await withFake(
    async () => {
      active++;
      peak = Math.max(peak, active);
      await Bun.sleep(15);
      active--;
      return OK;
    },
    async (bao) => {
      await run(
        { BAO_ADDR: bao.address },
        Effect.all(
          Array.from({ length: 32 }, (_, i) =>
            i % 2 === 0 ? Effect.asVoid(readPolicy(`p${i}`)) : Effect.asVoid(baoRead(`p${i}`)),
          ),
          { concurrency: 'unbounded' },
        ),
      );
      expect(peak).toBe(MAX_IN_FLIGHT);
      expect(bao.seen).toHaveLength(32);
    },
  );
});

test('a sent write is bounded, not retried, and releases its permit', async () => {
  await withFake(
    async ({ method }) => {
      if (method === 'POST') {
        await Bun.sleep(120);
        return { status: 204 };
      }
      return OK;
    },
    async (bao) => {
      const gate = Semaphore.makeUnsafe(1);
      const write = runBao(
        policiesWriteAclPolicy({ name: 'test', policy: 'path "test" {}' }),
        '30 millis',
      );
      const error = await runFailure(
        { BAO_ADDR: bao.address },
        write.pipe(Effect.provideService(BaoGate, gate)),
      );
      expect(error).toMatchObject({ _tag: 'TimeoutError' });
      await run(
        { BAO_ADDR: bao.address },
        readPolicy('test').pipe(Effect.provideService(BaoGate, gate)),
      );
      expect(bao.seen.filter(({ method }) => method === 'POST')).toHaveLength(1);
    },
  );
});

test('the SDK keeps x-vault-token in Effect trace redaction alongside default names', async () => {
  let names: ReadonlyArray<RegExp | string> = [];
  const client = HttpClient.make((request, _url, _signal, fiber) => {
    names = fiber.getRef(Headers.CurrentRedactedNames);
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(OK.json)));
  });
  await Effect.runPromise(
    runBao(policiesReadAclPolicy({ name: 'test' })).pipe(
      Effect.provideService(BaoEnv, {
        BAO_ADDR: 'http://fake.invalid',
        BAO_TOKEN: 'never-log-this',
      }),
      Effect.provideService(HttpClient.HttpClient, client),
    ),
  );
  expect(names).toContain('x-vault-token');
  expect(names).toContain('authorization');
});

test('transport failures cannot serialize the request token after the fiber context unwinds', async () => {
  const gone = fakeBao(() => OK);
  gone.stop();
  const token = 'fixture-private-bao-token';
  const error = await runFailure({ BAO_ADDR: gone.address, BAO_TOKEN: token }, readPolicy('test'));
  expect(error).toBeInstanceOf(BaoError);
  expect(JSON.stringify(error)).not.toContain(token);
  expect(String(error)).not.toContain(token);
});
