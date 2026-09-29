/**
 * `LiteLLM.MCPServer`'s handlers and operations called directly, for what the engine harness cannot
 * show: that nothing a proxy returns can reach an attribute, and that delete is idempotent by a
 * real read.
 *
 * ⚠️ CALLING A HANDLER DIRECTLY IS NOT THE SHAPE THE ENGINE USES for a create-first replace
 *   (`output: undefined, olds: undefined` under a fresh instance id) — that path is
 *   `mcp-server.test.ts`, through `fakeStack`. What is checked here does not depend on it.
 * ★ EVERY VALUE IS `FAKE-*`.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { credentials } from '@distilled.cloud/litellm/Credentials';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { FAKE_BASE } from './fake-litellm.ts';
import { serverRow, startFakeMcpLitellm } from './fake-mcp-litellm.ts';
import { mcpServerHandlers } from './mcp-server.ts';
import { deleteMcpServer, listMcpServers } from './mcp-server-operations.ts';
import type { McpServerProps } from './mcp-server-types.ts';

const KEY = 'sk-test-master';
const VARIABLE = 'FAKE_MCP_HANDLER_TOKEN';

/**
 * ⚠️ `R` IS `unknown` BECAUSE `reconcile`'s type still names `InstanceId | Stack | Stage`, which
 *   `createPhysicalName` needs and a declared `serverId` never reaches; the cast below is the same
 *   one `pass-through-endpoint-delete-swallow.test.ts` makes.
 */
const run = <A, E>(
  fetchFn: typeof globalThis.fetch,
  effect: Effect.Effect<A, E, unknown>,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)),
      Effect.provide(credentials({ apiKey: KEY, baseUrl: FAKE_BASE })),
    ) as Effect.Effect<A, E, never>,
  );

const props: McpServerProps = {
  authType: 'bearer_token',
  authValue: { fromEnv: VARIABLE },
  serverName: 'FAKE_docs',
  transport: 'http',
  url: 'https://mcp.example.com/mcp',
};

beforeEach(() => {
  process.env[VARIABLE] = 'FAKE-handler-secret';
});
afterEach(() => {
  delete process.env[VARIABLE];
});

describe('reading a server never reveals auth material', () => {
  // ⚠️ the fake's worst case: a proxy whose list hands every stored secret back
  const leaky = serverRow({
    credentials: { auth_value: 'FAKE-live-secret' },
    env_vars: [{ name: 'FAKE_ENV', scope: 'global', value: 'FAKE-env-secret' }],
    server_id: 'FAKE-uuid-1',
    server_name: 'FAKE_docs',
    static_headers: { Authorization: 'FAKE-header-secret' },
    url: 'https://mcp.example.com/mcp?token=FAKE-url-secret',
  });

  test('read of an adopted row: no credential, header, env value or url token in the attributes', async () => {
    const fake = startFakeMcpLitellm({ echoCredentials: true, masterKey: KEY, seed: [leaky] });
    const read = await run(
      fake.fetch,
      mcpServerHandlers.read({ id: 'Docs', instanceId: 'i', olds: props, output: undefined }),
    );
    const text = JSON.stringify(read);
    for (const secret of [
      'FAKE-live-secret',
      'FAKE-env-secret',
      'FAKE-header-secret',
      'FAKE-url-secret',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('REDACTED');
  });

  test('reconcile: the attributes hold a seal, never the credential it sent', async () => {
    const fake = startFakeMcpLitellm({ echoCredentials: true, masterKey: KEY });
    // ⚠️ `serverId` declared: a direct call has no Stack for `createPhysicalName` to read.
    const attributes = await run(
      fake.fetch,
      mcpServerHandlers.reconcile({
        id: 'Docs',
        instanceId: 'i',
        news: { ...props, serverId: 'FAKE-uuid-2' },
        output: undefined,
      }),
    );
    expect(JSON.stringify(attributes)).not.toContain('FAKE-handler-secret');
    expect(attributes.credentialSeal).toStartWith('scrypt:');
    // ★ the credential did reach the proxy — that is the write — and only there
    expect(fake.servers()[0]?.['credentials']).toEqual({ auth_value: 'FAKE-handler-secret' });
  });

  test('the sealed variable name is the only thing the declaration holds', () => {
    expect(JSON.stringify(props)).not.toContain('FAKE-handler-secret');
  });
});

describe('list', () => {
  test('answers the rows from a bare array', async () => {
    const fake = startFakeMcpLitellm({
      masterKey: KEY,
      seed: [serverRow({ server_id: 'FAKE-1' })],
    });
    expect((await run(fake.fetch, listMcpServers())).map((row) => row.server_id)).toEqual([
      'FAKE-1',
    ]);
  });

  test('refuses an answer that is not a list of servers', async () => {
    const notAList = (async () =>
      new Response(JSON.stringify({ detail: 'nope' }), {
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch;
    await expect(run(notAList, listMcpServers())).rejects.toThrow();
  });
});

describe('delete', () => {
  const row = serverRow({ server_id: 'FAKE-uuid-1', server_name: 'FAKE_docs' });

  test('removes a live row', async () => {
    const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [row] });
    await run(fake.fetch, deleteMcpServer('FAKE-uuid-1'));
    expect(fake.servers()).toEqual([]);
  });

  test('an id already gone is done, and no DELETE is sent', async () => {
    const fake = startFakeMcpLitellm({ masterKey: KEY });
    await expect(run(fake.fetch, deleteMcpServer('FAKE-never'))).resolves.toBeUndefined();
    expect(fake.requests().some((call) => call.method === 'DELETE')).toBe(false);
  });

  test('a delete refused for another reason is not swallowed: it fails and the row is live', async () => {
    // ⚠️ the fake answers 400 to every DELETE — the status of "no rights" is unmeasured on the
    //   real route, which is exactly why the read, not the status, decides.
    const fake = startFakeMcpLitellm({ forbidDelete: true, masterKey: KEY, seed: [row] });
    await expect(run(fake.fetch, deleteMcpServer('FAKE-uuid-1'))).rejects.toThrow();
    expect(fake.servers()).toHaveLength(1);
  });
});
