/**
 * `LiteLLM.MCPServer`: the list is the proxy's in-memory REGISTRY, not the table, so a row missing
 * from it can still be live.
 *
 * ⛔ MEASURED 2026-09-29 by reading the live 1.103.0 container: `GET /v1/mcp/server` answers
 *   `global_mcp_server_manager`'s registry, which `reload_servers_from_database` fills only from rows
 *   whose approval status is null, active or approved and skips a row whose build throws; the caller's
 *   key can narrow it too; and `add_mcp_server` only LOGS a failed registry refresh after the row is
 *   committed. The by-id `GET` reads the table first and registers what it finds; `DELETE` acts on
 *   the table. So absence from the list proves nothing, and these tests hold the resource to that.
 * ★ EVERY VALUE IS `FAKE-*` or an RFC 2606 host.
 */
import { describe, expect, test } from 'bun:test';
import { credentials } from '@distilled.cloud/litellm/Credentials';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { FAKE_BASE } from './fake-litellm.ts';
import {
  type FakeMcpLitellm,
  type FakeMcpOptions,
  serverRow,
  startFakeMcpLitellm,
} from './fake-mcp-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMMCPServer, mcpServerHandlers } from './mcp-server.ts';
import { deleteMcpServer, readMcpServer } from './mcp-server-operations.ts';
import type { McpServerProps } from './mcp-server-types.ts';

const KEY = 'sk-test-master';

const run = <A, E>(fetchFn: typeof globalThis.fetch, effect: Effect.Effect<A, E, unknown>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn)),
      Effect.provide(credentials({ apiKey: KEY, baseUrl: FAKE_BASE })),
    ) as Effect.Effect<A, E, never>,
  );

const stack = (fake: FakeMcpLitellm) => fakeStack({ apiKey: KEY, baseUrl: FAKE_BASE }, fake.fetch);
const start = (options: FakeMcpOptions = {}) => startFakeMcpLitellm({ masterKey: KEY, ...options });
const props: McpServerProps = {
  authType: 'none',
  serverName: 'FAKE_docs',
  transport: 'http',
  url: 'https://mcp.example.com/mcp',
};
const row = serverRow({
  server_id: 'FAKE-uuid-1',
  server_name: 'FAKE_docs',
  url: 'https://mcp.example.com/mcp',
});

describe('delete does not trust the list', () => {
  test('a live row the registry lacks is still deleted', async () => {
    const fake = start({ registryMisses: ['FAKE-uuid-1'], seed: [row] });
    expect(await run(fake.fetch, deleteMcpServer('FAKE-uuid-1'))).toBeUndefined();
    expect(fake.servers()).toEqual([]);
    expect(writesOf(fake.requests())).toEqual(['DELETE /v1/mcp/server/FAKE-uuid-1']);
  });

  test('a row already gone is done: the DELETE is sent, its 404 is confirmed by the table read', async () => {
    const fake = start();
    await run(fake.fetch, deleteMcpServer('FAKE-never'));
    expect(fake.requests().map((call) => `${call.method} ${call.path}`)).toEqual([
      'DELETE /v1/mcp/server/FAKE-never',
      'GET /v1/mcp/server/FAKE-never',
    ]);
  });

  test('a refused delete of a row the registry lacks fails, and the row stays live', async () => {
    const fake = start({ forbidDelete: true, registryMisses: ['FAKE-uuid-1'], seed: [row] });
    await expect(run(fake.fetch, deleteMcpServer('FAKE-uuid-1'))).rejects.toThrow();
    expect(fake.servers()).toHaveLength(1);
  });

  test('a refused delete whose confirming read also fails re-raises the original, never done', async () => {
    const fake = start({ forbidDelete: true, readFails: true, seed: [row] });
    await expect(run(fake.fetch, deleteMcpServer('FAKE-uuid-1'))).rejects.toThrow();
    // a read that cannot say is not absence, even for an id the proxy does not have
    const gone = start({ forbidDelete: true, readFails: true });
    await expect(run(gone.fetch, deleteMcpServer('FAKE-never'))).rejects.toThrow();
  });
});

describe('the by-id read', () => {
  test('answers the row, and undefined for a missing id', async () => {
    const fake = start({ seed: [row] });
    expect((await run(fake.fetch, readMcpServer('FAKE-uuid-1')))?.server_id).toBe('FAKE-uuid-1');
    expect(await run(fake.fetch, readMcpServer('FAKE-never'))).toBeUndefined();
  });

  test('an id that is another server’s NAME reads as absent, never as that server', async () => {
    // ⚠️ measured: with no table row, `fetch_mcp_server` falls back to a lookup by name or alias
    const fake = start({ seed: [row] });
    expect(await run(fake.fetch, readMcpServer('FAKE_docs'))).toBeUndefined();
  });

  test('any failure but "not found" propagates instead of reading as absence', async () => {
    const fake = start({ readFails: true, seed: [row] });
    await expect(run(fake.fetch, readMcpServer('FAKE-uuid-1'))).rejects.toThrow();
  });
});

describe('a row the registry lacks is found by id, so it is never created again', () => {
  test('a create whose registry refresh failed reads back from the table and records the row', async () => {
    const fake = start({ hideCreated: true });
    const engine = stack(fake);
    const declare = Effect.asVoid(LiteLLMMCPServer('Docs', props));
    expect(await engine.deploy(declare)).toEqual({ Docs: 'create' });
    expect(writesOf(fake.requests())).toHaveLength(1);
    // the by-id read registered the row, and the next deploy neither POSTs nor updates
    expect(await engine.deploy(declare)).toEqual({ Docs: 'noop' });
    expect(writesOf(fake.requests())).toHaveLength(1);
  });

  test('adopting a pinned row the registry lacks writes nothing, where a POST would answer 400 "already exists"', async () => {
    const fake = start({ registryMisses: ['FAKE-uuid-1'], seed: [row] });
    const declare = Effect.asVoid(LiteLLMMCPServer('Docs', { ...props, serverId: 'FAKE-uuid-1' }));
    expect(await stack(fake).deploy(declare, { adopt: true })).toEqual({ Docs: 'adopted' });
    expect(writesOf(fake.requests())).toEqual([]);
  });

  test('a refresh read of an owned row the registry lacks returns it, not undefined', async () => {
    const fake = start({ registryMisses: ['FAKE-uuid-1'], seed: [row] });
    const output = {
      alias: null,
      allowAllKeys: false,
      allowedTools: [],
      authType: 'none',
      credentialSeal: '',
      description: null,
      mcpAccessGroups: [],
      serverId: 'FAKE-uuid-1',
      serverName: 'FAKE_docs',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
    };
    const read = await run(
      fake.fetch,
      mcpServerHandlers.read({ id: 'Docs', instanceId: 'i', olds: props, output }),
    );
    expect(read).toMatchObject({ serverId: 'FAKE-uuid-1' });
  });
});
