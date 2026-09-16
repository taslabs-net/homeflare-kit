/**
 * The environment contract, pinned to what openbao v2.6.2's CLI client does — see the citations in
 * bao-address.ts. Pure: nothing here opens a connection.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_ADDRESS, headersFor, resolveAddress } from './bao-address.ts';

const TOKEN = 'hvs.FAKE-sentinel-never-a-real-token';

describe('resolveAddress', () => {
  it("falls back to the CLI's default address when nothing is set", () => {
    assert.deepEqual(resolveAddress({}), {
      base: DEFAULT_ADDRESS,
      namespace: undefined,
      socket: undefined,
    });
  });

  it('strips a trailing slash and keeps a path prefix', () => {
    assert.equal(
      resolveAddress({ BAO_ADDR: 'https://bao.example:8200/' }).base,
      'https://bao.example:8200',
    );
    assert.equal(
      resolveAddress({ BAO_ADDR: 'https://edge.example/bao/' }).base,
      'https://edge.example/bao',
    );
  });

  it('lets BAO_AGENT_ADDR win over BAO_ADDR', () => {
    const env = {
      BAO_ADDR: 'https://server.example:8200',
      BAO_AGENT_ADDR: 'http://127.0.0.1:8100',
    };
    assert.equal(resolveAddress(env).base, 'http://127.0.0.1:8100');
  });

  it('falls back to VAULT_ADDR, but a present-and-empty BAO_ADDR still wins', () => {
    assert.equal(
      resolveAddress({ VAULT_ADDR: 'https://vault.example' }).base,
      'https://vault.example',
    );
    assert.equal(
      resolveAddress({ BAO_ADDR: '', VAULT_ADDR: 'https://vault.example' }).base,
      DEFAULT_ADDRESS,
    );
  });

  it('turns unix:///path into plain HTTP to localhost over that socket', () => {
    assert.deepEqual(resolveAddress({ BAO_ADDR: 'unix:///run/openbao/agent.sock' }), {
      base: 'http://localhost',
      namespace: undefined,
      socket: '/run/openbao/agent.sock',
    });
  });

  it('carries a namespace only when it is non-empty', () => {
    assert.equal(resolveAddress({ BAO_NAMESPACE: 'homeflare' }).namespace, 'homeflare');
    assert.equal(resolveAddress({ BAO_NAMESPACE: '' }).namespace, undefined);
  });
});

describe('headersFor', () => {
  it('sends the token and the namespace when both are set', () => {
    const env = { BAO_NAMESPACE: 'homeflare', BAO_TOKEN: TOKEN };
    assert.deepEqual(headersFor(resolveAddress(env), env), {
      'X-Vault-Namespace': 'homeflare',
      'X-Vault-Request': 'true',
      'X-Vault-Token': TOKEN,
    });
  });

  // ★ AGENT MODE. The agent substitutes its auto-auth token only when the request carries none.
  it('sends NO token header when BAO_TOKEN is unset or empty', () => {
    for (const env of [{}, { BAO_TOKEN: '' }]) {
      assert.deepEqual(headersFor(resolveAddress(env), env), { 'X-Vault-Request': 'true' });
    }
  });

  it('falls back to VAULT_TOKEN, as the CLI does', () => {
    const env = { VAULT_TOKEN: TOKEN };
    assert.equal(headersFor(resolveAddress(env), env)['X-Vault-Token'], TOKEN);
  });

  it('keeps the token out of the resolved address', () => {
    assert.ok(!JSON.stringify(resolveAddress({ BAO_TOKEN: TOKEN })).includes(TOKEN));
  });
});
