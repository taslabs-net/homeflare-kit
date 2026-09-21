/**
 * The guards: derive-version, stage, identity. Each must REFUSE, not warn.
 */
import { describe, expect, test } from 'bun:test';
import {
  SiteError,
  VERSION,
  assertIdentity,
  assertStage,
  checkDeriveVersion,
  compareIdentity,
  decodeSite,
  expectedIdentity,
} from '../src/index.ts';
import { example, withPath } from './fixture.ts';

function refusal(f: () => unknown): SiteError {
  try {
    f();
  } catch (error) {
    if (error instanceof SiteError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

const site = decodeSite(example());

describe('deriveVersion', () => {
  test('the example is reviewed against THIS package version', async () => {
    // ⛔ scripts/sync-versions.ts rewrites it on every version bump; if that ever stops,
    //   a freshly copied example would refuse to load.
    const pkg = (await Bun.file(new URL('../package.json', import.meta.url)).json()) as {
      version: string;
    };
    expect(site.deriveVersion).toBe(pkg.version);
    expect(site.deriveVersion).toBe(VERSION);
  });

  test('a mismatch refuses at decode, naming both versions and the fix', () => {
    const error = refusal(() => decodeSite(withPath(example(), ['deriveVersion'], '9.9.9')));
    expect(error.code).toBe('derive-version');
    expect(error.message).toContain('9.9.9');
    expect(error.message).toContain(VERSION);
    expect(error.message).toContain(`"deriveVersion": "${VERSION}"`);
  });

  test('the installed version is what is compared', () => {
    expect(refusal(() => decodeSite(example(), { installed: '0.99.0' })).code).toBe(
      'derive-version',
    );
    expect(() => checkDeriveVersion(site, site.deriveVersion)).not.toThrow();
  });
});

describe('stage', () => {
  test('an example site can never plan stage live', () => {
    const error = refusal(() => assertStage(site, 'live'));
    expect(error.code).toBe('stage');
    expect(error.message).toContain('kind "example"');
  });

  test('a testing site can plan other stages; a live site can plan live', () => {
    const testing = decodeSite(withPath(example(), ['kind'], 'testing'));
    expect(() => assertStage(testing, 'dev')).not.toThrow();
    const live = decodeSite(withPath(example(), ['kind'], 'live'));
    expect(() => assertStage(live, 'live')).not.toThrow();
  });
});

describe('identity', () => {
  const expected = expectedIdentity(site, { account: 'main' });
  const observed = {
    vaultClusterName: 'example-vault',
    vaultNamespace: '',
    cloudflareAccountId: '00000000000000000000000000000001',
  };

  test('the expectation comes from the site', () => {
    expect(expected).toEqual(observed);
    expect(expectedIdentity(site)).toEqual({
      vaultClusterName: 'example-vault',
      vaultNamespace: '',
    });
  });

  test('a match is empty and does not throw', () => {
    expect(compareIdentity(expected, observed)).toEqual([]);
    expect(() => assertIdentity(expected, observed)).not.toThrow();
  });

  test('another vault is refused, naming the field and both values', () => {
    const other = { ...observed, vaultClusterName: 'another-vault' };
    expect(compareIdentity(expected, other)).toEqual([
      { field: 'vaultClusterName', expected: 'example-vault', observed: 'another-vault' },
    ]);
    const error = refusal(() => assertIdentity(expected, other));
    expect(error.code).toBe('identity');
    expect(error.issues).toEqual([
      'vaultClusterName: expected "example-vault", observed "another-vault"',
    ]);
  });

  test('another account is refused', () => {
    const other = { ...observed, cloudflareAccountId: '00000000000000000000000000000002' };
    expect(compareIdentity(expected, other).map((m) => m.field)).toEqual(['cloudflareAccountId']);
  });

  test('an unobserved field is a mismatch, never a pass', () => {
    // ⛔ "We did not check" must not read as "it matched".
    const { cloudflareAccountId: _skip, ...partial } = observed;
    expect(compareIdentity(expected, partial)).toEqual([
      { field: 'cloudflareAccountId', expected: observed.cloudflareAccountId, observed: undefined },
    ]);
  });

  test('an unknown account alias throws rather than skipping the account check', () => {
    expect(refusal(() => expectedIdentity(site, { account: 'typo' })).code).toBe('unknown-key');
  });
});
