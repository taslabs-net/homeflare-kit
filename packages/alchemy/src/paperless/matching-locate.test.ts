/**
 * `soleMatch`, `locateOne` and the PR 163 identity switch (`fetchLive`) — identity resolution, in
 * isolation. Pure/Effect only (no HTTP, `R = never`): every fixture is `Effect.succeed`, mirroring
 * `../netbox/resource.test.ts`'s own `locateOne` tests. `tag.test.ts`/`tag-identity.test.ts`
 * exercise the real distilled wire path this feeds from, plus the full PR 163 regression suite
 * this file does not repeat.
 *
 * ⛔ THE FAILURE `soleMatch` GUARDS IS SILENT AND SELF-RENEWING. If an ambiguous match took the
 *   first row, adopt would bind to it, the next plan would bind to the other, and every plan
 *   after that would report drift that is not there. Failing loudly is the only outcome an
 *   operator can act on. Ported verbatim from the pre-migration `client.test.ts`.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import { LOCATE_PAGE, fetchLive, locateOne, soleMatch } from './matching-locate.ts';

describe('soleMatch', () => {
  test('no candidate is absent, not an error — that is what plans a create', () => {
    expect(soleMatch([], 'tags Invoices')).toBeUndefined();
  });

  test('exactly one candidate is the object', () => {
    expect(soleMatch([{ id: 7 }], 'tags Invoices')).toEqual({ id: 7 });
  });

  /** ⛔ Two rows means the identity rule is wrong, and the message says which object it was. */
  test('more than one candidate throws and names the object', () => {
    expect(() => soleMatch([{ id: 7 }, { id: 8 }], 'tags Invoices')).toThrow(
      /tags Invoices matched 2 Paperless objects/,
    );
  });
});

interface Row {
  readonly id: number;
  readonly name: string;
}

const page = (results: readonly Row[]) => Effect.succeed({ count: results.length, results });

describe('locateOne', () => {
  test('an empty page is absent', async () => {
    expect(await Effect.runPromise(locateOne(page([]), 'tags Invoices'))).toBeUndefined();
  });

  test('one row with no `identifies` narrowing is the object', async () => {
    const row = await Effect.runPromise(
      locateOne(page([{ id: 7, name: 'Invoices' }]), 'tags Invoices'),
    );
    expect(row).toEqual({ id: 7, name: 'Invoices' });
  });

  test('`identifies` narrows several server-side matches to the declared one', async () => {
    const rows = [
      { id: 7, name: 'Invoices' },
      { id: 8, name: 'invoices' },
    ];
    const row = await Effect.runPromise(
      locateOne(page(rows), 'tags Invoices', (r) => r.name === 'invoices'),
    );
    expect(row).toEqual({ id: 8, name: 'invoices' });
  });

  test('more rows than the page width is a defect, not a truncation', async () => {
    const rows = Array.from({ length: LOCATE_PAGE + 1 }, (_, i) => ({ id: i, name: 'x' }));
    await expect(Effect.runPromise(locateOne(page(rows), 'tags Invoices'))).rejects.toThrow(
      /matched 21 rows, more than the 20-row page/,
    );
  });
});

describe('fetchLive (the PR 163 identity switch)', () => {
  const byName = (rows: readonly Row[]) => (props: { name: string }) =>
    locateOne(page(rows), `tags ${props.name}`, (r) => r.name === props.name);
  const byId = (rows: readonly Row[]) => (id: number) =>
    Effect.succeed(rows.find((r) => r.id === id));
  const describe_ = (props: { name: string }) => `tags ${props.name}`;

  test('no output: locates by name', async () => {
    const rows = [{ id: 7, name: 'Invoices' }];
    const live = await Effect.runPromise(
      fetchLive({ name: 'Invoices' }, undefined, byName(rows), byId(rows), describe_),
    );
    expect(live?.id).toBe(7);
  });

  test('output present: locates by id, ignoring a since-changed name', async () => {
    const rows = [{ id: 7, name: 'Renamed' }];
    const live = await Effect.runPromise(
      fetchLive({ name: 'Invoices' }, { id: 7 }, byName(rows), byId(rows), describe_),
    );
    expect(live?.id).toBe(7);
  });

  test('output.id no longer live: refuses rather than falling through to a create', async () => {
    await expect(
      Effect.runPromise(
        fetchLive({ name: 'Invoices' }, { id: 7 }, byName([]), byId([]), describe_),
      ),
    ).rejects.toThrow(/no longer exists live|deleted out of band/);
  });
});
