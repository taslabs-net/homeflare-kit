import { describe, expect, test } from 'bun:test';
import { isAlreadyPublishedConflict, summaryRow } from './publish-conflict.ts';

describe('isAlreadyPublishedConflict', () => {
  test('the real 409 text from run 35887402292 (staged wording)', () => {
    const out = [
      'npm error code E409',
      'npm error 409 Conflict - PUT https://registry.npmjs.org/@homeflare%2falchemy - ' +
        'Cannot publish over previously staged version "0.25.1".',
      'npm error A complete log of this run can be found in: ' +
        '/home/runner/.npm/_logs/2026-09-23T16_16_22_240Z-debug-0.log',
    ].join('\n');

    expect(isAlreadyPublishedConflict({ code: 1, out }, '0.25.1')).toBe(true);
  });

  test('the older "published" wording is the same race, not a different one', () => {
    const out =
      'npm error code E409\n' +
      'npm error 409 Conflict - PUT https://registry.npmjs.org/@homeflare%2fkit - ' +
      'Cannot publish over previously published version "0.5.0".';

    expect(isAlreadyPublishedConflict({ code: 1, out }, '0.5.0')).toBe(true);
  });

  test('a quoted version that does not match ours is not our race', () => {
    // Same phrasing, but npm is talking about a DIFFERENT version than the one this
    // call published — defensive: do not assume it is safe just because the shape
    // of the message matches.
    const out =
      'npm error code E409\n' +
      'npm error 409 Conflict - PUT https://registry.npmjs.org/@homeflare%2falchemy - ' +
      'Cannot publish over previously staged version "0.25.0".';

    expect(isAlreadyPublishedConflict({ code: 1, out }, '0.25.1')).toBe(false);
  });

  test('a different E409 — CouchDB-style conflict, unrelated to publishing — still throws', () => {
    // npm/npm#3320: registries built on CouchDB reuse 409 for a document update race
    // that has nothing to do with "this version is already published".
    const out =
      'npm error code E409\n' +
      'npm error 409 Conflict - PUT https://registry.npmjs.org/@homeflare%2fkit - ' +
      'Document update conflict.';

    expect(isAlreadyPublishedConflict({ code: 1, out }, '0.5.0')).toBe(false);
  });

  test('E403 (no publish permission) still throws', () => {
    const out =
      'npm error code E403\n' +
      'npm error 403 Forbidden - PUT https://registry.npmjs.org/@homeflare%2fkit - ' +
      'You do not have permission to publish "@homeflare/kit". Are you logged in as the ' +
      'correct user?';

    expect(isAlreadyPublishedConflict({ code: 1, out }, '0.5.0')).toBe(false);
  });

  test('E404 still throws', () => {
    const out =
      'npm error code E404\n' +
      'npm error 404 Not Found - GET https://registry.npmjs.org/@homeflare%2fnonexistent - Not found';

    expect(isAlreadyPublishedConflict({ code: 1, out }, '0.5.0')).toBe(false);
  });

  test('a network error still throws', () => {
    const out =
      'npm error code ENOTFOUND\n' +
      'npm error network request to https://registry.npmjs.org/@homeflare%2fkit failed, ' +
      'reason: getaddrinfo ENOTFOUND registry.npmjs.org';

    expect(isAlreadyPublishedConflict({ code: 1, out }, '0.5.0')).toBe(false);
  });

  test('a successful publish (exit 0) is never classified as a conflict', () => {
    expect(isAlreadyPublishedConflict({ code: 0, out: '' }, '0.5.0')).toBe(false);
  });

  test('npm 11 republish refusal with no E409 is this version already on the registry', () => {
    // Measured 2026-09-25, run 36148440975. No error code. The period is the sentence.
    const out = 'npm error You cannot publish over the previously published versions: 0.12.1.\n';
    expect(isAlreadyPublishedConflict({ code: 1, out }, '0.12.1')).toBe(true);
    expect(isAlreadyPublishedConflict({ code: 1, out }, '0.12.2')).toBe(false);
  });
});

describe('summaryRow', () => {
  const pkg = { name: '@homeflare/alchemy', version: '0.25.1' };

  test('a 409-conflict skip is flagged for a human, not shown as an ordinary success', () => {
    const row = summaryRow(pkg, true, true);
    expect(row).toContain('verify this is your content');
    expect(row).not.toContain('✅ on npm');
  });

  test('an ordinary live package still reads as on npm', () => {
    expect(summaryRow(pkg, true, false)).toBe('| `@homeflare/alchemy` | 0.25.1 | ✅ on npm |');
  });

  test('an ordinary not-yet-visible package still reads as pending', () => {
    const row = summaryRow(pkg, false, false);
    expect(row).toContain('⏳ not visible yet');
  });
});
