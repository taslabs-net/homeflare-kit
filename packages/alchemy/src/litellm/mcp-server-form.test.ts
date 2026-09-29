/**
 * The pure half of `LiteLLM.MCPServer`: what is refused, what a row is read as, what differs, and
 * what each write body carries. No server, no engine.
 *
 * ★ EVERY VALUE IS `FAKE-*` or an RFC 2606 host.
 */
import { describe, expect, test } from 'bun:test';
import * as Redacted from 'effect/Redacted';
import {
  createBody,
  differing,
  firstProblem,
  redactUrl,
  toAttributes,
  updateBody,
} from './mcp-server-form.ts';
import type { McpServerAttributes, McpServerProps } from './mcp-server-types.ts';

const base: McpServerProps = {
  authType: 'none',
  serverName: 'FAKE_docs',
  transport: 'http',
  url: 'https://mcp.example.com/mcp',
};

const attributes = (over: Partial<McpServerAttributes> = {}): McpServerAttributes => ({
  alias: null,
  allowAllKeys: false,
  allowedTools: [],
  authType: 'none',
  credentialSeal: '',
  description: null,
  mcpAccessGroups: [],
  serverId: 'FAKE-id',
  serverName: 'FAKE_docs',
  transport: 'http',
  url: 'https://mcp.example.com/mcp',
  ...over,
});

describe('what is refused before any request', () => {
  test('an ordinary declaration passes', () => {
    expect(firstProblem(base)).toBeUndefined();
  });

  test.each([
    ['a blank name', { ...base, serverName: ' ' }, 'serverName'],
    ['a padded name', { ...base, serverName: ' FAKE_docs' }, 'serverName'],
    ['stdio', { ...base, transport: 'stdio' as never }, 'stdio'],
    [
      'an auth type that needs credential fields not modelled',
      { ...base, authType: 'aws_sigv4' as never },
      'authType',
    ],
    ['a static type without a credential', { ...base, authType: 'api_key' as const }, 'authValue'],
    [
      'a credential on oauth2',
      { ...base, authType: 'oauth2' as const, authValue: { fromEnv: 'FAKE_VAR' } },
      'authValue',
    ],
    ['a blank tool name', { ...base, allowedTools: ['FAKE_tool', ''] }, 'allowedTools'],
    ['a scheme that is not http', { ...base, url: 'ftp://mcp.example.com/mcp' }, 'http'],
    ['a bare host', { ...base, url: 'mcp.example.com' }, 'url'],
    [
      'userinfo in the url',
      { ...base, url: 'https://FAKE-user:FAKE-pass@mcp.example.com/mcp' },
      'userinfo',
    ],
    ['a fragment', { ...base, url: 'https://mcp.example.com/mcp#frag' }, 'fragment'],
  ])('%s', (_label, props, mention) => {
    expect(firstProblem(props)).toContain(mention);
  });

  test('a secret-looking query parameter is refused by NAME and the value is never quoted', () => {
    const problem = firstProblem({
      ...base,
      url: 'https://mcp.example.com/mcp?api_key=FAKE-secret',
    });
    expect(problem).toContain('api_key');
    expect(problem).not.toContain('FAKE-secret');
  });

  test('a harmless query parameter is allowed', () => {
    expect(firstProblem({ ...base, url: 'https://mcp.example.com/mcp?region=eu' })).toBeUndefined();
  });
});

describe('redactUrl', () => {
  test('a url that needs nothing comes back byte for byte, bare origin included', () => {
    expect(redactUrl('https://mcp.example.com')).toBe('https://mcp.example.com');
    expect(redactUrl('https://mcp.example.com/mcp?region=eu')).toBe(
      'https://mcp.example.com/mcp?region=eu',
    );
  });

  test('userinfo and secret-looking query values are replaced', () => {
    const out = redactUrl(
      'https://FAKE-user:FAKE-pass@mcp.example.com/mcp?token=FAKE-t&keep=1&token=FAKE-u',
    );
    expect(out).not.toContain('FAKE-');
    expect(out).toContain('keep=1');
  });

  test('a string that is not a url is returned as it is', () => {
    expect(redactUrl('not a url')).toBe('not a url');
  });
});

describe('the read shape', () => {
  test('copies no credential and no header, whatever the row carries', () => {
    const row = {
      credentials: { auth_value: 'FAKE-live-secret', client_secret: 'FAKE-client-secret' },
      env: { FAKE_ENV: 'FAKE-env-secret' },
      env_vars: [{ name: 'FAKE_ENV', scope: 'global' as const }],
      server_id: 'FAKE-id',
      static_headers: { Authorization: 'FAKE-header-secret' },
      transport: 'sse' as const,
      url: 'https://mcp.example.com/sse?token=FAKE-url-secret',
    };
    const text = JSON.stringify(toAttributes(row));
    for (const secret of [
      'FAKE-live-secret',
      'FAKE-client-secret',
      'FAKE-env-secret',
      'FAKE-header-secret',
      'FAKE-url-secret',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(toAttributes(row).credentialSeal).toBe('');
  });

  test('a row with no auth type reads as none, and absent lists read as empty', () => {
    const live = toAttributes({ server_id: 'FAKE-id', transport: 'http', auth_type: null });
    expect(live).toMatchObject({
      allowAllKeys: false,
      allowedTools: [],
      authType: 'none',
      mcpAccessGroups: [],
    });
  });
});

describe('what differs', () => {
  test('nothing, for a live row that matches', () => {
    expect(differing(attributes(), base)).toEqual([]);
  });

  test('key and group grants are always compared, against a closed default', () => {
    const open = attributes({ allowAllKeys: true, mcpAccessGroups: ['FAKE_g'] });
    expect(differing(open, base)).toEqual(['allow_all_keys', 'mcp_access_groups']);
  });

  test('a tool list is compared only when declared: an undeclared one is never drift', () => {
    const whitelisted = attributes({ allowedTools: ['FAKE_a'] });
    expect(differing(whitelisted, base)).toEqual([]);
    // ⚠️ a declared `[]` is a real difference from a whitelist: it asks for "no restriction"
    expect(differing(whitelisted, { ...base, allowedTools: [] })).toEqual(['allowed_tools']);
    expect(differing(attributes(), { ...base, allowedTools: ['FAKE_a'] })).toEqual([
      'allowed_tools',
    ]);
  });

  test('lists compare as sets: order and repeats do not matter', () => {
    const live = attributes({ allowedTools: ['FAKE_b', 'FAKE_a'] });
    expect(differing(live, { ...base, allowedTools: ['FAKE_a', 'FAKE_b'] })).toEqual([]);
    expect(differing(live, { ...base, allowedTools: ['FAKE_a'] })).toEqual(['allowed_tools']);
  });

  test('alias and description are compared only when declared', () => {
    const live = attributes({ alias: 'FAKE_alias', description: 'a person wrote this' });
    expect(differing(live, base)).toEqual([]);
    expect(differing(live, { ...base, alias: 'other', description: 'other' })).toEqual([
      'alias',
      'description',
    ]);
  });

  test('a live url that carried a token differs from the clean declaration', () => {
    const live = attributes({ url: redactUrl('https://mcp.example.com/mcp?token=FAKE-t') });
    expect(differing(live, base)).toEqual(['url']);
  });
});

describe('the write bodies', () => {
  const token = Redacted.make('FAKE-token');

  test('a create carries the id, the managed set and the credential, and no undeclared field', () => {
    const body = createBody(
      { ...base, authType: 'bearer_token', authValue: { fromEnv: 'FAKE_VAR' } },
      'FAKE-id',
      token,
    );
    expect(body).toEqual({
      allow_all_keys: false,
      auth_type: 'bearer_token',
      credentials: { auth_value: 'FAKE-token' },
      mcp_access_groups: [],
      server_id: 'FAKE-id',
      server_name: 'FAKE_docs',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
    });
  });

  test('the declaration names the variable, never the value', () => {
    expect(JSON.stringify({ ...base, authValue: { fromEnv: 'FAKE_VAR' } })).not.toContain(
      'FAKE-token',
    );
    expect(JSON.stringify(token)).not.toContain('FAKE-token');
  });

  test('allowed_tools is sent only when declared, and a declared empty list is sent as it is', () => {
    for (const body of [
      createBody(base, 'FAKE-id', undefined),
      updateBody(base, 'FAKE-id', undefined, false),
    ]) {
      expect(body).not.toHaveProperty('allowed_tools');
    }
    expect(updateBody({ ...base, allowedTools: [] }, 'FAKE-id', undefined, false)).toHaveProperty(
      'allowed_tools',
      [],
    );
    expect(createBody({ ...base, allowedTools: ['FAKE_a'] }, 'FAKE-id', undefined)).toHaveProperty(
      'allowed_tools',
      ['FAKE_a'],
    );
  });

  test('an update with no credential sends no credentials key, so the stored one is left', () => {
    expect(updateBody(base, 'FAKE-id', undefined, false)).not.toHaveProperty('credentials');
  });

  test('leaving a static type sends an explicit null', () => {
    expect(updateBody(base, 'FAKE-id', undefined, true)).toHaveProperty('credentials', null);
  });
});
