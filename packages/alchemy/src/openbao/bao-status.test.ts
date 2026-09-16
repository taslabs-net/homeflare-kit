/**
 * The classification every read and every delete in this package rests on.
 *
 * ⛔ BOTH DIRECTIONS ARE PINNED, BECAUSE EACH HAS ALREADY BEEN WRONG ONCE. Every non-zero exit used
 *   to read as "absent" — a bad token planned 33 updates against a vault that was fine — and one
 *   command's absence wording was assumed for another's, so a policy that did not exist yet could
 *   not be created. These replace bao-shell.test.ts's stderr cases with the status codes those
 *   stderr lines were rendering: a missing role (404), a refused policy read under the agent lane
 *   (403 — `Code: 403 … permission denied`, measured 2026-09-14), a missing policy under the admin
 *   lane (404), and a server that is not listening (no response at all, bao-http.test.ts).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BaoError, settle } from './bao-status.ts';

const ROLE = 'pki/roles/does-not-exist-zzz';
const POLICY = 'sys/policies/acl/zz-new-policy';
const NONE = JSON.stringify({ errors: [] });
const DENIED = JSON.stringify({ errors: ['1 error occurred:\n\t* permission denied\n\n'] });
const SEALED = JSON.stringify({ errors: ['Vault is sealed'] });

const errorOf = (outcome: ReturnType<typeof settle>) => {
  assert.ok('error' in outcome, 'expected a failure');
  return outcome.error;
};

describe('settle', () => {
  it('passes a JSON body through on success', () => {
    assert.deepEqual(settle('read', 'GET', ROLE, 200, '{"data":{"ttl":3600}}'), {
      body: { data: { ttl: 3600 } },
    });
  });

  it('reads an OpenBao 404 as absent on a read', () => {
    assert.deepEqual(settle('read', 'GET', ROLE, 404, NONE), { body: undefined });
  });

  // ⛔ THE BUG SHAPE b3c18a33e FIXED. A policy that does not exist yet is the same 404 as any other
  //    absent object — there is no second wording left to get wrong.
  it('reads a policy that does not exist yet as absent', () => {
    assert.deepEqual(settle('read', 'GET', POLICY, 404, NONE), { body: undefined });
  });

  it('treats a 404 as success on a delete, because a delete must be idempotent', () => {
    assert.deepEqual(settle('delete', 'DELETE', POLICY, 404, NONE), { body: undefined });
  });

  it('accepts a 204 with no body on a write and on a delete', () => {
    assert.deepEqual(settle('write', 'PUT', POLICY, 204, ''), { body: undefined });
    assert.deepEqual(settle('delete', 'DELETE', POLICY, 204, ''), { body: undefined });
  });

  it('fails a 404 on a write, carrying OpenBao errors', () => {
    const errors = ['no handler for route "nope/roles/x". route entry not found.'];
    const error = errorOf(settle('write', 'PUT', 'nope/roles/x', 404, JSON.stringify({ errors })));
    assert.deepEqual(error.errors, errors);
  });

  // ⛔ AND DENIAL IS NEVER ABSENCE, on a read or on a delete.
  it('fails a refused read and a refused delete (403)', () => {
    assert.equal(errorOf(settle('read', 'GET', POLICY, 403, DENIED)).status, 403);
    assert.equal(errorOf(settle('delete', 'DELETE', POLICY, 403, DENIED)).status, 403);
  });

  it('fails a sealed server (503) on every intent', () => {
    for (const intent of ['read', 'write', 'delete'] as const) {
      assert.equal(errorOf(settle(intent, 'GET', ROLE, 503, SEALED)).status, 503);
    }
  });

  it('fails a 400 and a 500', () => {
    assert.equal(errorOf(settle('read', 'GET', ROLE, 400, NONE)).status, 400);
    assert.equal(errorOf(settle('read', 'GET', ROLE, 500, NONE)).status, 500);
  });

  // ⚠️ A BAO_ADDR pointed at the wrong server must not plan CREATE for everything.
  it('does not read a 404 that is not an OpenBao body as absent', () => {
    const error = errorOf(settle('read', 'GET', ROLE, 404, '<html>Not Found</html>'));
    assert.match(error.message, /not an OpenBao error body/);
    assert.ok('error' in settle('delete', 'DELETE', ROLE, 404, '<html>Not Found</html>'));
  });

  it('fails a successful read that has no body', () => {
    assert.equal(errorOf(settle('read', 'GET', ROLE, 200, '')).status, 200);
  });

  // ⛔ A success body can hold a credential, so a malformed one is described and never quoted.
  it('fails an unparseable success body without quoting it', () => {
    const error = errorOf(settle('read', 'GET', 'pbs-tb4/creds/read', 200, 'secret=abc123 {'));
    assert.ok(!error.message.includes('abc123'));
  });

  // ⛔ A JSON gateway's error shape is not OpenBao's, even on a 404 (grok, 2026-09-14).
  it('does not read a 404 whose errors are objects as absent, on a read or a delete', () => {
    const gateway = JSON.stringify({ errors: [{ code: 1000, message: 'Not Found' }] });
    const error = errorOf(settle('read', 'GET', ROLE, 404, gateway));
    assert.match(error.message, /not an OpenBao error body/);
    assert.ok('error' in settle('delete', 'DELETE', ROLE, 404, gateway));
  });

  // ⛔ An error page that echoes the request back must not carry the token into the message.
  it('describes a foreign error body without quoting it', () => {
    const echo = '<pre>X-Vault-Token: hvs.sentinel-not-a-token</pre>';
    const error = errorOf(settle('read', 'GET', ROLE, 502, echo));
    assert.ok(!error.message.includes('hvs.sentinel'));
  });

  it('names the method and path, and carries the errors array', () => {
    const error = errorOf(settle('read', 'GET', POLICY, 403, DENIED));
    assert.ok(error instanceof BaoError);
    assert.match(error.message, /^OpenBao GET \/v1\/sys\/policies\/acl\/zz-new-policy -> 403: /);
    assert.deepEqual(error.errors, ['1 error occurred:\n\t* permission denied\n\n']);
  });
});
