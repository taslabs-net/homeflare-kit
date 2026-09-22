/**
 * Bao.Plugin's form: what a declaration may say, the body it registers with, and the equality a
 * plan's `noop` rests on. The shapes are the v2.6.2 handler's (plugin-form.ts cites the lines).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type BaoPluginProps,
  attributesOf,
  matches,
  problems,
  registerBody,
  resolve,
  versionedPath,
} from './plugin-form.ts';

const SUM = '0123456789abcdef'.repeat(4);
const UNVERSIONED: BaoPluginProps = {
  command: 'openbao-plugin-secrets-cloudflare',
  name: 'openbao-plugin-secrets-cloudflare',
  sha256: SUM.toUpperCase(),
  type: 'secret',
};
const PROPS: BaoPluginProps = { ...UNVERSIONED, version: 'v0.1.2' };

describe('plugin form', () => {
  it('resolves the defaults the register call stores, and lower-cases the sum', () => {
    const form = resolve(UNVERSIONED);
    assert.equal(form.sha256, SUM);
    assert.deepEqual(form.args, []);
    assert.equal(form.version, '');
    assert.deepEqual(problems(resolve(PROPS)), []);
  });

  it('refuses what the server would reject or store differently', () => {
    const bad = (patch: Partial<BaoPluginProps>) => problems(resolve({ ...PROPS, ...patch }));
    for (const name of ['a/b', '..x', '', 'has space']) assert.equal(bad({ name }).length, 1);
    assert.equal(bad({ sha256: 'abc' }).length, 1);
    for (const command of ['plugin --flag', 'sub/plugin', '/abs/plugin', '../plugin', './plugin']) {
      assert.equal(bad({ command }).length, 1, command);
    }
    // ⚠️ Accepted by the server but stored canonicalised, so they would never read back equal.
    for (const version of ['1.2.0', 'v1.2', 'v01.2.0']) assert.equal(bad({ version }).length, 1);
    assert.ok(bad({ version: 'v1.2.0+builtin' }).length > 0);
    assert.deepEqual(bad({ version: 'v1.2.0-rc.1' }), []);
  });

  it('reads and deletes one version, and registers at the unversioned path', () => {
    assert.equal(
      versionedPath('secret', 'x', 'v1.0.0+meta'),
      'sys/plugins/catalog/secret/x?version=v1.0.0%2Bmeta',
    );
    assert.equal(versionedPath('auth', 'x', ''), 'sys/plugins/catalog/auth/x');
  });

  it('registers with the RegisterPluginInput fields and never env or a numeric type', () => {
    assert.deepEqual(registerBody(resolve(PROPS)), {
      command: PROPS.command,
      sha256: SUM,
      version: 'v0.1.2',
    });
    const withArgs = registerBody(resolve({ ...UNVERSIONED, args: ['--b', '--a'] }));
    assert.deepEqual(withArgs, { args: ['--b', '--a'], command: PROPS.command, sha256: SUM });
    assert.equal('env' in withArgs || 'type' in withArgs, false);
  });

  it('matches the live entry by value, args in order, and never a builtin', () => {
    const form = resolve({ ...PROPS, args: ['--a', '--b'] });
    const live = {
      args: ['--a', '--b'],
      builtin: false,
      command: PROPS.command,
      declarative: false,
      name: PROPS.name,
      oci: false,
      sha256: SUM,
      version: 'v0.1.2',
    };
    assert.equal(matches(attributesOf(form, live), form), true);
    assert.equal(matches(attributesOf(form, { ...live, args: ['--b', '--a'] }), form), false);
    assert.equal(matches(attributesOf(form, { ...live, sha256: 'f'.repeat(64) }), form), false);
    assert.equal(matches(attributesOf(form, { ...live, builtin: true }), form), false);
    const bare = resolve(UNVERSIONED);
    assert.deepEqual(attributesOf(bare, { ...live, args: null, version: '' }).args, []);
  });
});
