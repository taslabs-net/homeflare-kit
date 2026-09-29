/**
 * The public barrel re-exports every typed refusal, including the one a shadowed description raises.
 * A missing name here is a runtime import failure: the class exists in mcp-server-errors.ts either way.
 */
import { expect, test } from 'bun:test';
import { LitellmMcpServerDescriptionShadowedError } from './index.ts';

test('LitellmMcpServerDescriptionShadowedError is on the litellm barrel', () => {
  const error = new LitellmMcpServerDescriptionShadowedError({
    serverId: 'FAKE-id',
    serverName: 'FAKE_web',
  });
  expect(error._tag).toBe('LitellmMcpServerDescriptionShadowedError');
  expect(error.message).toContain('FAKE_web');
});
