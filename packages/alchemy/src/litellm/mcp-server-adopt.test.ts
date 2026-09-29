/**
 * `LiteLLM.MCPServer`: adopting a row that already holds a credential, and removal.
 *
 * ★ A CREDENTIAL CANNOT BE READ BACK, so an adopted row has no seal. The declaration is
 *   authoritative: with the variable set it is written once (and sealed); with it unset the plan
 *   cannot tell, so nothing is written and nothing is demanded.
 * ⚠️ The fake hides `credentials` on read, like the real proxy is assumed to (unmeasured).
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { FAKE_BASE } from './fake-litellm.ts';
import { type FakeMcpLitellm, serverRow, startFakeMcpLitellm } from './fake-mcp-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMMCPServer } from './mcp-server.ts';
import type { McpServerProps } from './mcp-server-types.ts';

const KEY = 'sk-test-master';
const VARIABLE = 'FAKE_MCP_ADOPT_TOKEN';

const stack = (fake: FakeMcpLitellm) => fakeStack({ apiKey: KEY, baseUrl: FAKE_BASE }, fake.fetch);

const props: McpServerProps = {
  authType: 'api_key',
  authValue: { fromEnv: VARIABLE },
  serverName: 'FAKE_keyed',
  transport: 'http',
  url: 'https://keyed.example.com/mcp',
};
const held = serverRow({
  auth_type: 'api_key',
  server_id: 'FAKE-uuid-9',
  server_name: 'FAKE_keyed',
  url: 'https://keyed.example.com/mcp',
});

beforeEach(() => {
  process.env[VARIABLE] = 'FAKE-adopt-one';
});
afterEach(() => {
  delete process.env[VARIABLE];
});

test('adopting with the variable set writes the declared credential once, then is a no-op', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [held] });
  const engine = stack(fake);
  const declare = Effect.asVoid(LiteLLMMCPServer('Keyed', props));
  await engine.deploy(declare, { adopt: true });
  expect(fake.servers()[0]?.['credentials']).toEqual({ auth_value: 'FAKE-adopt-one' });
  const before = fake.requests().length;
  expect(await engine.deploy(declare, { adopt: true })).toEqual({ Keyed: 'noop' });
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
});

test('adopting with the variable unset writes nothing and demands nothing; a later deploy with it set writes', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [held] });
  const engine = stack(fake);
  const declare = Effect.asVoid(LiteLLMMCPServer('Keyed', props));
  delete process.env[VARIABLE];
  await engine.deploy(declare, { adopt: true });
  expect(writesOf(fake.requests())).toEqual([]);
  process.env[VARIABLE] = 'FAKE-adopt-two';
  expect(await engine.deploy(declare)).toEqual({ Keyed: 'update' });
  expect(fake.servers()[0]?.['credentials']).toEqual({ auth_value: 'FAKE-adopt-two' });
});

test('under RemovalPolicy.destroy() a removed declaration deletes the row; the default retains it', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY });
  const engine = stack(fake);
  const noCredential: McpServerProps = {
    authType: 'none',
    serverName: props.serverName,
    transport: props.transport,
    url: props.url,
  };
  await engine.deploy(
    Effect.asVoid(LiteLLMMCPServer('Gone', noCredential).pipe(RemovalPolicy.destroy())),
  );
  expect(fake.servers()).toHaveLength(1);
  expect(await engine.deploy(Effect.void)).toEqual({ Gone: 'delete' });
  expect(fake.servers()).toEqual([]);

  await engine.deploy(Effect.asVoid(LiteLLMMCPServer('Kept', noCredential)));
  await engine.deploy(Effect.void);
  expect(fake.servers()).toHaveLength(1);
});
