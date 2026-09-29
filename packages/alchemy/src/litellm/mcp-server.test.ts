/**
 * `LiteLLM.MCPServer` through Alchemy's real Plan and Apply over the fake proxy
 * (`fake-mcp-litellm.ts`): create, no-op, rotate, adopt by name and drift.
 *
 * ★ EVERY VALUE IS `FAKE-*`, and the credential reaches the resource only through an environment
 *   variable the test sets and removes, exactly as a deploying process would.
 * ⚠️ WHAT THE FAKE MODELS IS ITS OWN CHOICE, NOT A MEASUREMENT OF LITELLM 1.103.0 (see the fake).
 *   A test that leans on one of those choices says so.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_BASE } from './fake-litellm.ts';
import { type FakeMcpLitellm, serverRow, startFakeMcpLitellm } from './fake-mcp-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMMCPServer } from './mcp-server.ts';
import type { McpServerProps } from './mcp-server-types.ts';

const KEY = 'sk-test-master';
const VARIABLE = 'FAKE_MCP_SERVER_TOKEN';

const stack = (fake: FakeMcpLitellm) => fakeStack({ apiKey: KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: McpServerProps, name = 'Docs') =>
  Effect.gen(function* () {
    yield* LiteLLMMCPServer(name, props);
  });

const docs: McpServerProps = {
  authType: 'bearer_token',
  authValue: { fromEnv: VARIABLE },
  serverName: 'FAKE_docs',
  transport: 'http',
  url: 'https://mcp.example.com/mcp',
};

const live = serverRow({
  server_id: 'FAKE-uuid-1',
  server_name: 'FAKE_search',
  transport: 'sse',
  url: 'https://search.example.com/sse',
});
const search: McpServerProps = {
  authType: 'none',
  serverName: 'FAKE_search',
  transport: 'sse',
  url: 'https://search.example.com/sse',
};

beforeEach(() => {
  process.env[VARIABLE] = 'FAKE-token-one';
});
afterEach(() => {
  delete process.env[VARIABLE];
});

test('creates a server, sends the credential once, and defaults every access grant to closed', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY });
  expect(await stack(fake).deploy(declare(docs))).toEqual({ Docs: 'create' });
  const [row] = fake.servers();
  expect(row).toMatchObject({
    allow_all_keys: false,
    allowed_tools: [],
    auth_type: 'bearer_token',
    mcp_access_groups: [],
    server_name: 'FAKE_docs',
    transport: 'http',
    url: 'https://mcp.example.com/mcp',
  });
  expect(row?.['credentials']).toEqual({ auth_value: 'FAKE-token-one' });
  // ★ a deterministic physical name, not a proxy-issued uuid
  expect(String(row?.['server_id'])).toMatch(/^[a-z0-9-]+$/);
});

test('a second deploy of the same declaration writes nothing', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(docs));
  const before = fake.requests().length;
  expect(await same.deploy(declare(docs))).toEqual({ Docs: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('a rotated credential is an update that carries the new value, then a no-op', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(docs));
  process.env[VARIABLE] = 'FAKE-token-two';
  expect(await same.deploy(declare(docs))).toEqual({ Docs: 'update' });
  expect(fake.servers()[0]?.['credentials']).toEqual({ auth_value: 'FAKE-token-two' });
  expect(await same.deploy(declare(docs))).toEqual({ Docs: 'noop' });
});

test('an unset variable is "cannot tell", never drift: an unchanged server stays a no-op', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(docs));
  delete process.env[VARIABLE];
  const before = fake.requests().length;
  expect(await same.deploy(declare(docs))).toEqual({ Docs: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('a create whose variable is unset is refused, names the variable, and writes nothing', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY });
  delete process.env[VARIABLE];
  const failure = await stack(fake)
    .deploy(declare(docs))
    .then(
      () => undefined,
      (error: unknown) => String(error),
    );
  expect(failure).toContain(VARIABLE);
  expect(writesOf(fake.requests())).toEqual([]);
});

test('a refused declaration fails the plan before a single request, so nothing invalid is stored', async () => {
  for (const props of [
    { ...docs, url: 'https://mcp.example.com/mcp?token=FAKE-in-url' },
    { ...docs, authValue: undefined },
    { ...docs, transport: 'stdio' as never },
  ]) {
    const fake = startFakeMcpLitellm({ masterKey: KEY });
    await expect(stack(fake).deploy(declare(props as McpServerProps))).rejects.toThrow();
    expect(fake.requests()).toEqual([]);
  }
});

test('a live row is Unowned: refused without --adopt, taken by name with it, with no write', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [live] });
  const engine = stack(fake);
  await expect(engine.deploy(declare(search, 'Search'))).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
  const planned = await engine.deploy(declare(search, 'Search'), { adopt: true });
  expect(Object.values(planned)).toEqual(['adopted']);
  expect(writesOf(fake.requests())).toEqual([]);
});

test('adopting an open server planned closed: allow_all_keys and the tool list are corrected', async () => {
  const open = serverRow({
    ...live,
    allow_all_keys: true,
    allowed_tools: ['FAKE_tool_a'],
  });
  const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [open] });
  await stack(fake).deploy(declare(search, 'Search'), { adopt: true });
  expect(fake.servers()[0]).toMatchObject({ allow_all_keys: false, allowed_tools: [] });
  // ★ the update sent the whole managed set, and left the id alone
  expect(fake.bodies()[0]).toMatchObject({ server_id: 'FAKE-uuid-1', allow_all_keys: false });
});

test('two live rows with the declared name are refused, never guessed at', async () => {
  const twin = serverRow({ ...live, server_id: 'FAKE-uuid-2' });
  const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [live, twin] });
  await expect(stack(fake).deploy(declare(search, 'Search'), { adopt: true })).rejects.toThrow();
  expect(writesOf(fake.requests())).toEqual([]);
});

test('a declared serverId pins one of two same-named rows', async () => {
  const twin = serverRow({ ...live, server_id: 'FAKE-uuid-2' });
  const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [live, twin] });
  const planned = await stack(fake).deploy(
    declare({ ...search, serverId: 'FAKE-uuid-2' }, 'Search'),
    { adopt: true },
  );
  expect(Object.values(planned)).toEqual(['adopted']);
});

test('a proxy that drops an edit it cannot apply fails the deploy instead of claiming success', async () => {
  // ⚠️ the fake's own model of a truthiness check on the edit route — unmeasured at 1.103.0
  const open = serverRow({ ...live, allow_all_keys: true });
  const fake = startFakeMcpLitellm({ editIgnoresFalsy: true, masterKey: KEY, seed: [open] });
  await expect(stack(fake).deploy(declare(search, 'Search'), { adopt: true })).rejects.toThrow();
});

test('the id the proxy issues is the one recorded: the next deploy is a no-op on it', async () => {
  const fake = startFakeMcpLitellm({ issuesOwnId: true, masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(search, 'Search'));
  expect(fake.servers()[0]?.['server_id']).toBe('FAKE-issued-id-0001');
  const before = fake.requests().length;
  expect(await same.deploy(declare(search, 'Search'))).toEqual({ Search: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('moving off a static auth type sends credentials: null and forgets the seal', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare(docs));
  const oauth: McpServerProps = {
    authType: 'oauth2',
    serverName: docs.serverName,
    transport: docs.transport,
    url: docs.url,
  };
  expect(await same.deploy(declare(oauth))).toEqual({ Docs: 'update' });
  expect(fake.bodies().at(-1)).toMatchObject({ auth_type: 'oauth2', credentials: null });
  expect(fake.servers()[0]?.['credentials']).toBeNull();
  expect(await same.deploy(declare(oauth))).toEqual({ Docs: 'noop' });
});

test('a changed declared serverId is a replace, create-first, and the old row is retained', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY });
  const same = stack(fake);
  await same.deploy(declare({ ...search, serverId: 'FAKE-id-a' }, 'Search'));
  const planned = await same.deploy(declare({ ...search, serverId: 'FAKE-id-b' }, 'Search'));
  expect(planned).toEqual({ Search: 'replace' });
  // ★ `defaultRemovalPolicy: 'retain'`: nothing removes a server unless the stack opts in
  expect(fake.servers().map((row) => row['server_id'])).toEqual(['FAKE-id-a', 'FAKE-id-b']);
});
