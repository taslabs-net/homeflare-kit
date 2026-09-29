/**
 * `LiteLLM.MCPServer`: changing a server's auth type, through Alchemy's real Plan and Apply.
 *
 * ⛔ LITELLM WIPES THE STORED CREDENTIAL ON AN AUTH-CLASS CHANGE THAT SENDS NONE. Read from the live
 *   1.103.0 container (`mcp_server/db.py` lines 1013-1014; `_credential_auth_class` keeps every
 *   static type in its own class) and modelled by the fake as its one MEASURED rule. A resource that
 *   let such an edit through with the variable unset would leave the row with no credential while
 *   its seal still matched the old value, so the next deploy would call it converged and stay so.
 * ★ EVERY VALUE IS `FAKE-*`, set and removed through the environment like a deploying process.
 */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_BASE } from './fake-litellm.ts';
import { type FakeMcpLitellm, serverRow, startFakeMcpLitellm } from './fake-mcp-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMMCPServer } from './mcp-server.ts';
import type { McpServerProps } from './mcp-server-types.ts';

const KEY = 'sk-test-master';
const VARIABLE = 'FAKE_MCP_RETYPE_TOKEN';

const stack = (fake: FakeMcpLitellm) => fakeStack({ apiKey: KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: McpServerProps) => Effect.asVoid(LiteLLMMCPServer('Keyed', props));

const bearer: McpServerProps = {
  authType: 'bearer_token',
  authValue: { fromEnv: VARIABLE },
  serverName: 'FAKE_keyed',
  transport: 'http',
  url: 'https://keyed.example.com/mcp',
};
const keyed: McpServerProps = { ...bearer, authType: 'api_key' };

const message = (failure: Promise<unknown>) =>
  failure.then(
    () => undefined,
    (error: unknown) => String(error),
  );

beforeEach(() => {
  process.env[VARIABLE] = 'FAKE-token-one';
});
afterEach(() => {
  delete process.env[VARIABLE];
});

test('between two static types with the variable unset: refused, names it, writes nothing, keeps the credential', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY });
  const engine = stack(fake);
  await engine.deploy(declare(bearer));
  delete process.env[VARIABLE];
  const before = fake.requests().length;
  const failure = await message(engine.deploy(declare(keyed)));
  expect(failure).toContain(VARIABLE);
  expect(writesOf(fake.requests().slice(before))).toEqual([]);
  expect(fake.servers()[0]).toMatchObject({
    auth_type: 'bearer_token',
    credentials: { auth_value: 'FAKE-token-one' },
  });
});

test('the refused switch is recoverable: with the variable set again the credential is written, then a no-op', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY });
  const engine = stack(fake);
  await engine.deploy(declare(bearer));
  delete process.env[VARIABLE];
  await message(engine.deploy(declare(keyed)));
  process.env[VARIABLE] = 'FAKE-token-two';
  expect(await engine.deploy(declare(keyed))).toEqual({ Keyed: 'update' });
  expect(fake.servers()[0]).toMatchObject({
    auth_type: 'api_key',
    credentials: { auth_value: 'FAKE-token-two' },
  });
  expect(await engine.deploy(declare(keyed))).toEqual({ Keyed: 'noop' });
});

test('between two static types with the variable set: the credential rides the same write, so nothing is wiped', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY });
  const engine = stack(fake);
  await engine.deploy(declare(bearer));
  expect(await engine.deploy(declare(keyed))).toEqual({ Keyed: 'update' });
  expect(fake.bodies().at(-1)).toMatchObject({
    auth_type: 'api_key',
    credentials: { auth_value: 'FAKE-token-one' },
  });
  expect(fake.servers()[0]?.['credentials']).toEqual({ auth_value: 'FAKE-token-one' });
  expect(await engine.deploy(declare(keyed))).toEqual({ Keyed: 'noop' });
});

test('adopting a row with no auth type as a static one demands the credential too', async () => {
  const bare = serverRow({
    server_id: 'FAKE-uuid-5',
    server_name: 'FAKE_keyed',
    url: 'https://keyed.example.com/mcp',
  });
  const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [bare] });
  delete process.env[VARIABLE];
  const failure = await message(stack(fake).deploy(declare(bearer), { adopt: true }));
  expect(failure).toContain(VARIABLE);
  expect(writesOf(fake.requests())).toEqual([]);
});

test('an unchanged auth type with the variable unset is still updated, without touching the credential', async () => {
  const fake = startFakeMcpLitellm({ masterKey: KEY });
  const engine = stack(fake);
  await engine.deploy(declare(bearer));
  delete process.env[VARIABLE];
  const before = fake.requests().length;
  const described = { ...bearer, description: 'FAKE description' };
  expect(await engine.deploy(declare(described))).toEqual({ Keyed: 'update' });
  expect(fake.bodies().at(-1)).not.toHaveProperty('credentials');
  expect(fake.servers()[0]?.['credentials']).toEqual({ auth_value: 'FAKE-token-one' });
  expect(writesOf(fake.requests().slice(before))).toHaveLength(1);
});
