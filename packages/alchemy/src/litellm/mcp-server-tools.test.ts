/**
 * `LiteLLM.MCPServer`: the tool whitelist (`allowedTools`) through Alchemy's real Plan and Apply.
 *
 * ⛔ AN EMPTY LIST IS THE OPEN STATE, NOT A CLOSED ONE. On the live 1.103.0 container a row with no
 *   `mcp_info` enforce flag and an empty `allowed_tools` returns every tool (`server.py` lines
 *   1692-1698, `mcp_server/utils.py`'s `server_applies_tool_allowlist`), so a resource that sent `[]`
 *   for an undeclared list would switch a live whitelist off when the row is adopted. Undeclared
 *   means "leave it"; only a declared list, `[]` included, is compared and sent.
 * ★ EVERY VALUE IS `FAKE-*` or an RFC 2606 host.
 */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_BASE } from './fake-litellm.ts';
import { type FakeMcpLitellm, serverRow, startFakeMcpLitellm } from './fake-mcp-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMMCPServer } from './mcp-server.ts';
import type { McpServerProps } from './mcp-server-types.ts';

const KEY = 'sk-test-master';
const TOOLS = ['FAKE_read', 'FAKE_write', 'FAKE_search'];

const stack = (fake: FakeMcpLitellm) => fakeStack({ apiKey: KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: McpServerProps) => Effect.asVoid(LiteLLMMCPServer('Bindings', props));

/** A live row with a whitelist, like an adopted `Cloudflare_Bindings`. */
const whitelisted = serverRow({
  allowed_tools: TOOLS,
  auth_type: 'oauth2',
  server_id: 'FAKE-uuid-3',
  server_name: 'FAKE_bindings',
  transport: 'http',
  url: 'https://bindings.example.com/mcp',
});
const withoutList: McpServerProps = {
  authType: 'oauth2',
  serverName: 'FAKE_bindings',
  transport: 'http',
  url: 'https://bindings.example.com/mcp',
};

test('adopting a whitelisted row without restating its list keeps the whitelist and writes nothing', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [whitelisted] });
  const planned = await stack(fake).deploy(declare(withoutList), { adopt: true });
  expect(Object.values(planned)).toEqual(['adopted']);
  expect(writesOf(fake.requests())).toEqual([]);
  expect(fake.servers()[0]?.['allowed_tools']).toEqual(TOOLS);
});

test('a grant that must change on such a row is corrected without sending the list', async () => {
  const open = serverRow({ ...whitelisted, allow_all_keys: true });
  const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [open] });
  const planned = await stack(fake).deploy(declare(withoutList), { adopt: true });
  // ⚠️ Alchemy's adoption branch plans `adopted` even when reconcile then writes: no `update` shows
  expect(Object.values(planned)).toEqual(['adopted']);
  expect(fake.bodies()).toHaveLength(1);
  expect(fake.bodies()[0]).toMatchObject({ allow_all_keys: false });
  expect(fake.bodies()[0]).not.toHaveProperty('allowed_tools');
  expect(fake.servers()[0]).toMatchObject({ allow_all_keys: false, allowed_tools: TOOLS });
});

test('a declared list is authoritative: it replaces the live one, order and repeats aside', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [whitelisted] });
  const engine = stack(fake);
  const same = { ...withoutList, allowedTools: [...TOOLS].reverse() };
  await engine.deploy(declare(same), { adopt: true });
  expect(writesOf(fake.requests())).toEqual([]);

  const narrower = { ...withoutList, allowedTools: ['FAKE_read'] };
  expect(await engine.deploy(declare(narrower))).toEqual({ Bindings: 'update' });
  expect(fake.bodies().at(-1)).toMatchObject({ allowed_tools: ['FAKE_read'] });
  expect(fake.servers()[0]?.['allowed_tools']).toEqual(['FAKE_read']);
});

test('a declared empty list is sent as it is: an explicit "no restriction", never an accident', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [whitelisted] });
  await stack(fake).deploy(declare({ ...withoutList, allowedTools: [] }), { adopt: true });
  expect(fake.bodies()[0]).toMatchObject({ allowed_tools: [] });
  expect(fake.servers()[0]?.['allowed_tools']).toEqual([]);
});

test('a create that declares no list sends none', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY });
  expect(await stack(fake).deploy(declare(withoutList))).toEqual({ Bindings: 'create' });
  expect(fake.bodies()[0]).not.toHaveProperty('allowed_tools');
});
