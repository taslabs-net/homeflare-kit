/**
 * `credential-form.ts`'s refusals, read shape and comparison — pure: no server, no environment
 * (the values' own behaviour is credential-values.ts's, tested through the resource test).
 *
 * ★ EVERY VALUE IS `FAKE-*`.
 */
import { expect, test } from 'bun:test';
import * as Redacted from 'effect/Redacted';
import {
  createBody,
  differing,
  firstProblem,
  isCredentialRow,
  literalValues,
  patchBody,
  removedInfoKeys,
  toAttributes,
} from './credential-form.ts';
import type { CredentialAttributes, CredentialProps } from './credential-types.ts';
import type { ResolvedValues } from './credential-values.ts';

const VARIABLE = 'FAKE_CREDENTIAL_KEY';
const base: CredentialProps = {
  credentialInfo: { note: 'docs search' },
  credentialName: 'FAKE_api',
  credentialValues: { api_key: { fromEnv: VARIABLE } },
};

/** Live attributes as the resource would hold them, over a metadata map. */
const attributes = (info: Record<string, unknown>, seal = ''): CredentialAttributes => ({
  credentialInfo: info,
  credentialName: 'FAKE_api',
  valuesSeal: seal,
});

test('firstProblem refuses the combinations nobody meant', () => {
  const cases: readonly [label: string, props: CredentialProps, fragment: string][] = [
    ['a blank name', { ...base, credentialName: '  ' }, 'credentialName'],
    ['a padded name', { ...base, credentialName: ' FAKE_api' }, 'credentialName'],
    ['a non-object metadata map', { ...base, credentialInfo: null as never }, 'credentialInfo'],
    [
      'a sensitive metadata key',
      { ...base, credentialInfo: { authToken: 'FAKE-meta' } },
      'authToken',
    ],
    ['an empty values map', { ...base, credentialValues: {} }, 'credentialValues'],
    [
      'a padded values key',
      { ...base, credentialValues: { ' key': { fromEnv: VARIABLE } } },
      'credentialValues',
    ],
    [
      'a literal value',
      { ...base, credentialValues: { api_key: 'FAKE-literal' as never } },
      'credentialValues',
    ],
    [
      'a blank variable name',
      { ...base, credentialValues: { api_key: { fromEnv: ' ' } } },
      'credentialValues',
    ],
  ];
  for (const [label, props, fragment] of cases) {
    expect(firstProblem(props), label).toContain(fragment);
  }
  expect(firstProblem(base)).toBeUndefined();
});

test('toAttributes mirrors only the metadata the vendor answers unmasked, and no values at all', () => {
  const live = toAttributes({
    credential_info: { note: 'docs search', aws_secret: 'FAKE-clear-in-info' },
    credential_name: 'FAKE_api',
    credential_values: { api_key: 'FA****ey', region: 'us-east' },
  });
  expect(live).toEqual({
    credentialInfo: { note: 'docs search' },
    credentialName: 'FAKE_api',
    valueKeys: ['api_key', 'region'],
    infoKeys: ['aws_secret', 'note'],
    valuesSeal: '',
  });
});

test('differing compares per declared key only, deeply, ignoring object key order', () => {
  // This helper checks declared values; removedInfoKeys separately detects undeclared live keys.
  expect(differing(attributes({ note: 'docs search', extra: 'live' }), base)).toEqual([]);
  expect(differing(attributes({ note: 'docs search v2', extra: 'live' }), base)).toEqual([
    'credential_info.note',
  ]);
  expect(differing(attributes({}), base)).toEqual(['credential_info.note']);
  const nested = { ...base, credentialInfo: { scopes: ['read', 'write'], vendor: { a: 1, b: 2 } } };
  // object key order never matters; array order does — an array is an ordered list in JSON
  expect(
    differing(attributes({ scopes: ['read', 'write'], vendor: { b: 2, a: 1 } }), nested),
  ).toEqual([]);
  expect(
    differing(attributes({ scopes: ['write', 'read'], vendor: { a: 1, b: 2 } }), nested),
  ).toEqual(['credential_info.scopes']);
  expect(differing(attributes({ scopes: ['read'], vendor: { a: 1, b: 2 } }), nested)).toEqual([
    'credential_info.scopes',
  ]);
});

test('isCredentialRow accepts only a row with a string name', () => {
  expect(isCredentialRow({ credential_name: 'FAKE_api' })).toBe(true);
  expect(isCredentialRow({ credential_values: {} })).toBe(false);
  expect(isCredentialRow('not a row')).toBe(false);
  expect(isCredentialRow(null)).toBe(false);
});

test('createBody carries the name in the body and the values as literals, unwrapped once', () => {
  const resolved: ResolvedValues = {
    missing: [],
    values: { api_key: Redacted.make('FAKE-key-one') },
  };
  expect(literalValues(resolved)).toEqual({ api_key: 'FAKE-key-one' });
  const body = createBody(base, resolved);
  expect(body).toEqual({
    credential_info: { note: 'docs search' },
    credential_name: 'FAKE_api',
    credential_values: { api_key: 'FAKE-key-one' },
  });
  // the body carries the VALUE the proxy stores, never the variable NAME the declaration holds
  expect(JSON.stringify(body)).not.toContain(VARIABLE);
});

test('patchBody carries the name twice (path label and body field) and the info, values optional', () => {
  expect(patchBody(base, undefined)).toEqual({
    credential_info: { note: 'docs search' },
    credential_name: 'FAKE_api',
    credential_name_body: 'FAKE_api',
  });
  expect(patchBody(base, { api_key: 'FAKE-key-one' })).toEqual({
    credential_info: { note: 'docs search' },
    credential_name: 'FAKE_api',
    credential_name_body: 'FAKE_api',
    credential_values: { api_key: 'FAKE-key-one' },
  });
  // the body carries the VALUE, never the variable NAME the declaration holds
  expect(JSON.stringify(patchBody(base, { api_key: 'FAKE-key-one' }))).not.toContain(VARIABLE);
});

test('removedInfoKeys finds live keys absent from the full intended info map', () => {
  const prior = attributes({ note: 'docs search', team: 'a' });
  expect(removedInfoKeys(prior, base)).toEqual(['team']);
  expect(
    removedInfoKeys(prior, { ...base, credentialInfo: { note: 'docs search', team: 'a' } }),
  ).toEqual([]);
  // No live row means there is nothing to remove.
  expect(removedInfoKeys(undefined, base)).toEqual([]);
});
