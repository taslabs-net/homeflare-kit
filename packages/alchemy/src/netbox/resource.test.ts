/**
 * `soleMatch` and `locateOne` — identity resolution, and the two ways it must refuse. Pure/Effect
 * only (no HTTP): `locateOne` takes an already-built list `Effect`, so these run against
 * `Effect.succeed` fixtures rather than a fake server — `prefix.test.ts` exercises the real
 * distilled wire path this feeds from.
 *
 * ⛔ THE FAILURE THIS GUARDS IS SILENT AND SELF-RENEWING. If an ambiguous match took the first
 *   row, adopt would bind to it, the next plan would bind to the other, and every plan after that
 *   would report drift that is not there — while "fixing" it PATCHed one object with the other's
 *   declaration. Failing loudly is the only outcome an operator can act on. Ported verbatim from
 *   the pre-migration `client.test.ts`, which tested the same `soleMatch` before it moved here.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { LOCATE_PAGE, locateOne, soleMatch } from './resource.ts';

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

describe('locateOne', () => {
  const page = (count: number, results: readonly { id: number; vrf?: number }[]) =>
    Effect.succeed({ count, results });

  test('an empty page is absent', async () => {
    const result = await Effect.runPromise(locateOne(page(0, []), 'ipam/prefixes 10.0.0.0/24'));
    expect(result).toBeUndefined();
  });

  test('one row with no `identifies` narrowing is the object', async () => {
    const result = await Effect.runPromise(
      locateOne(page(1, [{ id: 7 }]), 'ipam/prefixes 10.0.0.0/24'),
    );
    expect(result).toEqual({ id: 7 });
  });

  test('`identifies` narrows several server-side matches to the declared one', async () => {
    const rows = [
      { id: 7, vrf: 1 },
      { id: 8, vrf: 2 },
    ];
    const result = await Effect.runPromise(
      locateOne(page(2, rows), 'ipam/prefixes 10.0.0.0/24', (row) => row.vrf === 2),
    );
    expect(result).toEqual({ id: 8, vrf: 2 });
  });

  test('more rows than the page width is a defect, not a truncation', async () => {
    const rows = Array.from({ length: LOCATE_PAGE + 1 }, (_, i) => ({ id: i }));
    await expect(
      Effect.runPromise(locateOne(page(LOCATE_PAGE + 1, rows), 'ipam/prefixes 10.0.0.0/24')),
    ).rejects.toThrow(/matched 21 rows, more than the 20-row page/);
  });
});
