/**
 * Auth-method shape: path, type, optional description/TTLs. No secrets.
 * The write bodies are what configure-engines POSTed for approle.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type BaoAuthMethodProps,
  attributesOf,
  authPath,
  enableBody,
  matches,
  readPath,
  tuneBody,
  tunePath,
  wantsTune,
} from './auth-method-form.ts';

const PROPS: BaoAuthMethodProps = {
  description: 'Alchemy and CI machine login',
  path: 'approle/',
  type: 'approle',
};

describe('auth-method form', () => {
  it('strips a trailing slash the way sys/auth keys are stored', () => {
    assert.equal(authPath('approle/'), 'approle');
    assert.equal(readPath('approle/'), 'sys/auth/approle');
    assert.equal(tunePath('approle'), 'sys/auth/approle/tune');
  });

  it('enables with type and description, the body configure-engines sent', () => {
    assert.deepEqual(enableBody(PROPS), {
      description: 'Alchemy and CI machine login',
      type: 'approle',
    });
    assert.deepEqual(enableBody({ path: 'approle', type: 'approle' }), { type: 'approle' });
  });

  it('tunes only named fields', () => {
    assert.deepEqual(tuneBody(PROPS), { description: 'Alchemy and CI machine login' });
    assert.deepEqual(tuneBody({ defaultLeaseTtl: '768h', path: 'approle', type: 'approle' }), {
      default_lease_ttl: '768h',
    });
    assert.equal(wantsTune({ path: 'approle', type: 'approle' }), false);
    assert.equal(wantsTune(PROPS), true);
  });

  it('reads live listing fields into attributes and matches the declaration', () => {
    const live = {
      config: { default_lease_ttl: 0, max_lease_ttl: 0 },
      description: 'Alchemy and CI machine login',
      type: 'approle',
    };
    const attrs = attributesOf(PROPS, live);
    assert.equal(attrs.path, 'approle');
    assert.equal(attrs.type, 'approle');
    assert.equal(attrs.description, 'Alchemy and CI machine login');
    assert.equal(matches(attrs, PROPS), true);
    assert.equal(matches(attrs, { ...PROPS, type: 'userpass' }), false);
  });
});
