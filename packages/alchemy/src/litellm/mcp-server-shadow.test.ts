/**
 * `LiteLLM.MCPServer`: a `description` that `mcp_info.description` would hide is refused before any
 * write (mcp-server-shadow.ts says why).
 *
 * ⛔ MEASURED 2026-09-29, read only: the list answers `mcp_info.description` when that KEY exists,
 *   else the description column, and the resource writes only the column. Live, `Memos_CF` has the key
 *   holding a JSON null with a NULL column, and `linear` has both as strings. The fake models the list
 *   rule, so a write to such a row lands in the column and the list keeps answering the old value.
 * ★ EVERY VALUE IS `FAKE-*` or an RFC 2606 host.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { FAKE_BASE } from './fake-litellm.ts';
import { type FakeMcpLitellm, serverRow, startFakeMcpLitellm } from './fake-mcp-litellm.ts';
import { fakeStack, writesOf } from './fake-stack.ts';
import { LiteLLMMCPServer } from './mcp-server.ts';
import type { McpServerProps } from './mcp-server-types.ts';

const KEY = 'sk-test-master';

const stack = (fake: FakeMcpLitellm) => fakeStack({ apiKey: KEY, baseUrl: FAKE_BASE }, fake.fetch);
const declare = (props: McpServerProps) => Effect.asVoid(LiteLLMMCPServer('Notes', props));
const base: McpServerProps = {
  authType: 'none',
  serverName: 'FAKE_notes',
  transport: 'http',
  url: 'https://notes.example.com/mcp',
};
const held = (over: Record<string, unknown>) =>
  serverRow({
    server_id: 'FAKE-notes-id',
    server_name: 'FAKE_notes',
    url: 'https://notes.example.com/mcp',
    ...over,
  });
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (error: unknown) => String(error),
  );

describe('a row whose mcp_info has a description key', () => {
  test.each([
    ['a null one (the Memos_CF shape)', { description: null, mcp_info: { description: null } }],
    [
      'a different string (the linear shape)',
      { description: 'FAKE old', mcp_info: { description: 'FAKE old' } },
    ],
  ])('%s: the declared description is refused, and nothing is written', async (_label, fields) => {
    const fake = startFakeMcpLitellm({ masterKey: KEY, seed: [held(fields)] });
    const message = await failure(
      stack(fake).deploy(declare({ ...base, description: 'FAKE new' }), { adopt: true }),
    );
    expect(message).toContain('LitellmMcpServerDescriptionShadowedError');
    expect(writesOf(fake.requests())).toEqual([]);
  });

  test('the same description is not a difference, so nothing is read or written', async () => {
    const fake = startFakeMcpLitellm({
      masterKey: KEY,
      seed: [held({ description: 'FAKE same', mcp_info: { description: 'FAKE same' } })],
    });
    const engine = stack(fake);
    await engine.deploy(declare({ ...base, description: 'FAKE same' }), { adopt: true });
    expect(writesOf(fake.requests())).toEqual([]);
  });

  test('no description declared: the row is adopted and its description left alone', async () => {
    const fake = startFakeMcpLitellm({
      masterKey: KEY,
      seed: [held({ mcp_info: { description: null } })],
    });
    await stack(fake).deploy(declare(base), { adopt: true });
    expect(writesOf(fake.requests())).toEqual([]);
  });
});

describe('a row without one', () => {
  test('a declared description is written to the column and read back', async () => {
    const fake = startFakeMcpLitellm({
      masterKey: KEY,
      seed: [held({ description: 'FAKE old', mcp_info: { server_name: 'FAKE_notes' } })],
    });
    const engine = stack(fake);
    await engine.deploy(declare({ ...base, description: 'FAKE new' }), { adopt: true });
    expect(fake.servers()[0]).toMatchObject({ description: 'FAKE new' });
    expect(await engine.deploy(declare({ ...base, description: 'FAKE new' }))).toEqual({
      Notes: 'noop',
    });
  });
});
