/**
 * `LiteLLM.MCPServer`: an update must not rewrite the alias, and the names LiteLLM refuses are
 * refused first.
 *
 * ⛔ MEASURED 2026-09-29 by running the live 1.103.0 container's own `validate_and_normalize_mcp_server_payload`
 *   and `_prepare_mcp_server_data` on edit bodies (no database, no network): a body with a `server_name`
 *   and no `alias` comes out with `alias = normalize(server_name)` and the alias IS written; a body with
 *   neither sends none. The alias is the tool prefix, so an update that sent the name alone renamed
 *   every tool of a row with a custom alias, and the plan showed `adopted` or an update with no alias.
 *   The fake models exactly that rule (`fake-mcp-litellm.ts`), and the first test pins the fake to it.
 * ★ EVERY VALUE IS `FAKE-*` or an RFC 2606 host.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_BASE } from './fake-litellm.ts';
import { type FakeMcpLitellm, serverRow, startFakeMcpLitellm } from './fake-mcp-litellm.ts';
import { fakeStack } from './fake-stack.ts';
import { LiteLLMMCPServer } from './mcp-server.ts';
import { createBody, firstProblem, updateBody } from './mcp-server-form.ts';
import type { McpServerAttributes, McpServerProps } from './mcp-server-types.ts';

const KEY = 'sk-test-master';

const stack = (fake: FakeMcpLitellm) => fakeStack({ apiKey: KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: McpServerProps) => Effect.asVoid(LiteLLMMCPServer('Web', props));

const base: McpServerProps = {
  authType: 'none',
  serverName: 'FAKE_web',
  transport: 'http',
  url: 'https://web.example.com/mcp',
};
/** A row a person aliased: its tools are `search-*`, and it is open to every key. */
const aliased = serverRow({
  alias: 'search',
  allow_all_keys: true,
  server_id: 'FAKE-web-id',
  server_name: 'FAKE_web',
  transport: 'http',
  url: 'https://web.example.com/mcp',
});
const live = (over: Partial<McpServerAttributes> = {}): McpServerAttributes => ({
  alias: 'search',
  allowAllKeys: false,
  allowedTools: [],
  authType: 'none',
  credentialSeal: '',
  description: null,
  mcpAccessGroups: [],
  serverId: 'FAKE-web-id',
  serverName: 'FAKE_web',
  transport: 'http',
  url: 'https://web.example.com/mcp',
  ...over,
});

const put = (fake: FakeMcpLitellm, body: Record<string, unknown>) =>
  fake.fetch(`${FAKE_BASE}/v1/mcp/server`, {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    method: 'PUT',
  });

test('the fake models the measured rule: a name with no alias rewrites the alias, neither leaves it', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [aliased] });
  await put(fake, { allow_all_keys: false, server_id: 'FAKE-web-id' });
  expect(fake.servers()[0]).toMatchObject({ alias: 'search' });
  await put(fake, { server_id: 'FAKE-web-id', server_name: 'FAKE_web' });
  expect(fake.servers()[0]).toMatchObject({ alias: 'FAKE_web' });
});

describe('the update body', () => {
  test('sends no server_name and no alias when the name is unchanged and no alias is declared', () => {
    const body = updateBody(base, 'FAKE-web-id', undefined, false, live());
    expect(body).not.toHaveProperty('server_name');
    expect(body).not.toHaveProperty('alias');
  });

  test('a rename re-sends the live alias, so the tool prefix survives', () => {
    const body = updateBody(
      { ...base, serverName: 'FAKE_web2' },
      'FAKE-web-id',
      undefined,
      false,
      live(),
    );
    expect(body).toMatchObject({ alias: 'search', server_name: 'FAKE_web2' });
  });

  test('a rename of a row with no alias sends the name alone: LiteLLM then defaults the alias', () => {
    const body = updateBody(
      { ...base, serverName: 'FAKE_web2' },
      'FAKE-web-id',
      undefined,
      false,
      live({ alias: null }),
    );
    expect(body).toHaveProperty('server_name', 'FAKE_web2');
    expect(body).not.toHaveProperty('alias');
  });

  test('a declared alias is sent, and wins over the live one', () => {
    const body = updateBody({ ...base, alias: 'docs' }, 'FAKE-web-id', undefined, false, live());
    expect(body).toHaveProperty('alias', 'docs');
    expect(body).not.toHaveProperty('server_name');
  });

  test('a create sends the name, and an alias only when declared', () => {
    expect(createBody(base, 'FAKE-web-id', undefined)).not.toHaveProperty('alias');
    expect(createBody({ ...base, alias: 'docs' }, 'FAKE-web-id', undefined)).toHaveProperty(
      'alias',
      'docs',
    );
    expect(createBody(base, 'FAKE-web-id', undefined)).toHaveProperty('server_name', 'FAKE_web');
  });
});

describe('through the engine', () => {
  test('adopting an aliased row and correcting its grant leaves the alias alone', async () => {
    const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [aliased] });
    // ⚠️ the plan says `adopted` even though reconcile writes (allow_all_keys true -> false)
    expect(await stack(fake).deploy(declare(base), { adopt: true })).toEqual({ Web: 'adopted' });
    const sent = fake.bodies();
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty('alias');
    expect(sent[0]).not.toHaveProperty('server_name');
    expect(fake.servers()[0]).toMatchObject({ alias: 'search', allow_all_keys: false });
  });

  test('a rename of an owned row keeps its custom alias, and the next deploy is a no-op', async () => {
    const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [aliased] });
    const engine = stack(fake);
    const pinned: McpServerProps = { ...base, serverId: 'FAKE-web-id' };
    await engine.deploy(declare(pinned), { adopt: true });
    expect(await engine.deploy(declare({ ...pinned, serverName: 'FAKE_web2' }))).toEqual({
      Web: 'update',
    });
    expect(fake.servers()[0]).toMatchObject({ alias: 'search', server_name: 'FAKE_web2' });
    expect(await engine.deploy(declare({ ...pinned, serverName: 'FAKE_web2' }))).toEqual({
      Web: 'noop',
    });
  });
});

describe('the names LiteLLM would refuse or rewrite', () => {
  test.each([
    ['a hyphen in serverName', { ...base, serverName: 'FAKE-web' }, 'serverName'],
    ['a hyphen in the alias', { ...base, alias: 'my-search' }, 'alias'],
    ['a space in the alias', { ...base, alias: 'my search' }, 'space'],
    ['a blank alias', { ...base, alias: ' ' }, 'alias'],
    ['a slash in serverName', { ...base, serverName: 'FAKE/web' }, 'serverName'],
    ['a colon in serverName', { ...base, serverName: 'FAKE:web' }, 'serverName'],
    ['an at-sign in serverName', { ...base, serverName: 'FAKE@web' }, 'serverName'],
    ['a slash in the alias', { ...base, alias: 'my/search' }, 'alias'],
    ['a colon in the alias', { ...base, alias: 'my:search' }, 'alias'],
    ['an at-sign in the alias', { ...base, alias: 'my@search' }, 'alias'],
  ])('%s is refused before any request', (_label, props, mention) => {
    expect(firstProblem(props)).toContain(mention);
  });

  test('a space in serverName is refused: LiteLLM 1.103 rejects it at apply, it is not stored as written', () => {
    const problem = firstProblem({ ...base, serverName: 'FAKE web' });
    expect(problem).toContain('serverName');
    expect(problem).toContain('space');
  });

  test('a serverName or alias longer than 128 characters is refused', () => {
    const over = 'A'.repeat(129);
    expect(firstProblem({ ...base, serverName: over })).toContain('128');
    expect(firstProblem({ ...base, alias: over })).toContain('128');
  });

  test('a name of letters, digits, "." and "_" up to 128 characters passes', () => {
    expect(
      firstProblem({ ...base, serverName: 'A'.repeat(128), alias: 'FAKE.web_1' }),
    ).toBeUndefined();
  });

  test('a declared blank description is refused: LiteLLM never copies it into mcp_info', () => {
    expect(firstProblem({ ...base, description: '' })).toContain('description');
    expect(firstProblem({ ...base, description: ' ' })).toContain('description');
    expect(firstProblem({ ...base, description: 'FAKE notes' })).toBeUndefined();
  });
});
