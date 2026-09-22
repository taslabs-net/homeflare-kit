/**
 * Identity resolution, and the two ways it must refuse.
 *
 * ⛔ THE FAILURE THIS GUARDS IS SILENT AND SELF-RENEWING. If an ambiguous match took the first
 *   row, adopt would bind to it, the next plan would bind to the other, and every plan after that
 *   would report drift that is not there — while "fixing" it PATCHed one object with the other's
 *   declaration. Failing loudly is the only outcome an operator can act on.
 */
import { describe, expect, test } from 'bun:test';
import { NetboxError, apiBase, soleMatch } from './client.ts';

describe('soleMatch', () => {
  test('no candidate is absent, not an error — that is what plans a create', () => {
    expect(soleMatch([], 'ipam/prefixes 10.0.0.0/24')).toBeUndefined();
  });

  test('exactly one candidate is the object', () => {
    expect(soleMatch([{ id: 7 }], 'ipam/prefixes 10.0.0.0/24')).toEqual({ id: 7 });
  });

  /** ⛔ Two rows means the identity rule is wrong, and the message says which object it was. */
  test('more than one candidate throws and names the object', () => {
    expect(() => soleMatch([{ id: 7 }, { id: 8 }], 'ipam/prefixes 10.0.0.0/24')).toThrow(
      /ipam\/prefixes 10\.0\.0\.0\/24 matched 2 NetBox objects/,
    );
  });
});

describe('the instance origin', () => {
  /**
   * ⛔ NO DEFAULT HOSTNAME. A published package that fell back to a loopback address would let a
   *   consumer who forgot the variable watch every call fail against a machine that is not
   *   theirs, rather than being told which variable is missing.
   */
  test('an unset or blank NETBOX_URL names the variable', () => {
    const before = process.env['NETBOX_URL'];
    try {
      delete process.env['NETBOX_URL'];
      expect(() => apiBase()).toThrow(/NETBOX_URL is not set/);
      process.env['NETBOX_URL'] = '   ';
      expect(() => apiBase()).toThrow(/NETBOX_URL is not set/);
    } finally {
      if (before === undefined) delete process.env['NETBOX_URL'];
      else process.env['NETBOX_URL'] = before;
    }
  });

  test('a trailing slash is stripped so paths do not double up', () => {
    const before = process.env['NETBOX_URL'];
    try {
      process.env['NETBOX_URL'] = 'https://netbox.example.com/';
      expect(apiBase()).toBe('https://netbox.example.com');
    } finally {
      if (before === undefined) delete process.env['NETBOX_URL'];
      else process.env['NETBOX_URL'] = before;
    }
  });
});

describe('NetboxError', () => {
  /** ⚠️ The status is on the instance, because `absentOn404` folds ONLY 404 and nothing else. */
  test('it carries the status a caller has to branch on', () => {
    const error = new NetboxError(404, 'GET', 'ipam/prefixes/', 'Not found.');
    expect(error.status).toBe(404);
    expect(error.message).toContain('NetBox GET ipam/prefixes/ -> 404');
  });
});
