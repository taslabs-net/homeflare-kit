/**
 * The pure decisions behind appRoleLogin: which failure a status is, which mounts may be spliced
 * into a URL, and what redaction removes. No server — approle-login.test.ts drives the fake.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { failureOf, loginPath, mountProblem, redact } from './approle-login-form.ts';

describe('failureOf', () => {
  it('reads 0 as unreachable, 2xx as a bad response, anything else as refused', () => {
    assert.equal(failureOf(0), 'unreachable');
    assert.equal(failureOf(200), 'response');
    assert.equal(failureOf(204), 'response');
    assert.equal(failureOf(400), 'refused');
    assert.equal(failureOf(503), 'refused');
  });
});

describe('mountProblem', () => {
  it('accepts plain and nested mounts, trimming outer slashes', () => {
    for (const mount of [undefined, 'approle', '/approle-hosts/', 'team/approle']) {
      assert.equal(mountProblem(mount), undefined, String(mount));
    }
    assert.equal(loginPath('/team/approle/'), 'auth/team/approle/login');
  });

  it('refuses anything the URL parser would move or cut short', () => {
    for (const mount of ['', '/', '..', 'a/../b', './a', 'a//b', 'a?b', 'a#b', 'a%2e', 'a b']) {
      assert.notEqual(mountProblem(mount), undefined, mount);
    }
  });
});

describe('redact', () => {
  it('removes the raw value wherever it appears', () => {
    assert.deepEqual(redact(['x secret-1 y secret-1'], ['secret-1']), [
      'x [redacted] y [redacted]',
    ]);
  });

  it('removes the %q form OpenBao echoes (path_login.go:291), escapes and all', () => {
    const secret = 'a"b\\c';
    const echoed = `invalid secret_id "a\\"b\\\\c"`;
    assert.deepEqual(redact([echoed], [secret]), ['invalid secret_id "[redacted]"']);
  });

  it('redacts the longer value first, so a shorter one cannot split it', () => {
    const [text] = redact(['role abc and secret abcdef'], ['abc', 'abcdef']);
    assert.equal(text, 'role [redacted] and secret [redacted]');
    assert.ok(!text?.includes('def'));
  });

  it('ignores an empty value rather than redacting every gap', () => {
    assert.deepEqual(redact(['kept'], ['']), ['kept']);
  });
});
