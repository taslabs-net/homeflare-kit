/**
 * The wire coercions, tested where they are load bearing.
 *
 * ★ THESE ARE NOT SMOKE TESTS. Every case here is a trap `values.ts` documents in prose, and prose
 *   does not fail a build. Each one is written so that REVERTING the behaviour it describes turns
 *   this file red — that is the only property that makes a test worth its lines.
 *
 * ⚠️ WHY THIS FILE EXISTS AT ALL, HONESTLY: `@homeflare/proxmox` declared a `test` script and
 *   shipped no tests, so `bun test` exited 1 on "No tests found" and the pre-push gate refused
 *   every push. The fix could have been a quieter test script. It is this instead, because the
 *   package had just grown thirteen resources standing on one shared module with nothing checking
 *   it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bool,
  canonicalToken,
  csv,
  flag,
  guestList,
  int,
  num,
  propertyString,
  text,
  withClears,
} from './values.ts';

describe('bool — reading a PVE boolean off the wire', () => {
  it('accepts all three spellings PVE actually sends', () => {
    for (const value of [1, true, '1']) assert.equal(bool(value), true, `${String(value)} is true`);
    for (const value of [0, false, '0'])
      assert.equal(bool(value), false, `${String(value)} is false`);
  });

  /**
   * ⛔ THE REGRESSION THIS FILE WAS WRITTEN FOR. An unset SectionConfig flag comes back `''`. Read
   *   as `false`, `backup-job.enabled` and `user.enable` — the two fields in this package that
   *   default ON — come back disabled, `matches` reports an update nobody asked for, and the
   *   deploy WRITES `enabled=0` onto a live backup job. Flip `bool` back to treating `''` as false
   *   and this case fails.
   */
  it('treats the empty string as absent, not as false', () => {
    assert.equal(bool('', true), true, "'' must take the caller's fallback");
    assert.equal(bool('', false), false);
  });

  it('treats null and undefined as absent', () => {
    assert.equal(bool(undefined, true), true);
    assert.equal(bool(null, true), true);
  });

  /** ⚠️ Documented limit: only `1` is true, so a multi-state flag cannot be read here by accident. */
  it('does not read an arbitrary non-zero number as true', () => {
    assert.equal(bool(2), false);
  });
});

describe('flag — writing a boolean into a PVE form', () => {
  it('is the inverse direction of bool, and says so in its types', () => {
    assert.equal(flag(true), '1');
    assert.equal(flag(false), '0');
  });

  /** ⛔ An undeclared field must not be sent: '0' would write PVE's default over what is live. */
  it('answers undefined for an undeclared field rather than 0', () => {
    assert.equal(flag(undefined), undefined);
  });
});

describe('int — PVE may spell the same field as a number or a string', () => {
  it('reads 8086 and "8086" as the same value', () => {
    assert.equal(int(8086, -1), int('8086', -1));
  });

  it('falls back rather than yielding NaN', () => {
    assert.equal(int('not-a-port', -1), -1);
    assert.equal(int(undefined, -1), -1);
  });

  /** ⚠️ 0 is a legitimate value, so it must survive — this is why -1 is the absent-marker. */
  it('keeps a real zero', () => {
    assert.equal(int(0, -1), 0);
  });
});

describe('num and text', () => {
  it('num takes the fallback for null, which PVE sends for an unset field', () => {
    assert.equal(num(null, 7), 7);
    assert.equal(num(3, 7), 3);
  });

  it('text defaults to the empty string', () => {
    assert.equal(text(undefined), '');
    assert.equal(text(42), '');
    assert.equal(text(42, 'fallback'), 'fallback', 'a non-string takes the fallback');
  });
});

describe('csv — a set PVE does not give back in the order it was handed', () => {
  it('is order insensitive, so two orderings compare equal', () => {
    assert.equal(csv(['n3', 'n2']), csv('n2,n3'));
  });

  it('trims and drops empties, so a trailing comma is not a phantom member', () => {
    assert.equal(csv('n2, n3,'), 'n2,n3');
  });
});

describe('guestList — order is not meaning, and the sort must be numeric', () => {
  /** ⛔ Sorted as TEXT, '101' precedes '99'. That is the whole reason this is not `csv`. */
  it('sorts numerically, not lexically', () => {
    assert.equal(guestList('99,101'), '99,101');
    assert.equal(guestList([101, 99]), '99,101');
  });

  it('reads the array and the string form identically', () => {
    assert.equal(guestList([101, 99]), guestList('101, 99'));
  });
});

describe('canonicalToken', () => {
  it('folds the words PVE accepts onto the digits it returns', () => {
    for (const yes of ['yes', 'true', 'on', '1']) assert.equal(canonicalToken(yes), '1');
    for (const no of ['no', 'false', 'off', '0']) assert.equal(canonicalToken(no), '0');
  });
});

describe('propertyString — one value in two shapes', () => {
  /**
   * ⛔ THE MEASURED FOREVER-DIFF. `fleecing` is WRITTEN as `enabled=0` and READ BACK as the object
   *   {"enabled":0}. If these two do not flatten to the same string, every plan reports an update
   *   on a job nobody touched.
   */
  it('flattens the written string and the read-back object to the same value', () => {
    assert.equal(
      propertyString('enabled=0,storage=local'),
      propertyString({ enabled: 0, storage: 'local' }),
    );
  });

  it('is order insensitive', () => {
    assert.equal(
      propertyString('storage=local,enabled=1'),
      propertyString('enabled=1,storage=local'),
    );
  });

  /** ⚠️ `fleecing=1` is shorthand for `fleecing=enabled=1`; unexpanded they never compare equal. */
  it('expands a bare token through defaultKey', () => {
    assert.equal(propertyString('1', 'enabled'), propertyString({ enabled: 1 }));
  });

  it('passes a bare token through unchanged when there is no defaultKey', () => {
    assert.notEqual(propertyString('1'), propertyString({ enabled: 1 }));
  });

  it('is empty for a value that is neither a string nor an object', () => {
    assert.equal(propertyString(undefined), '');
  });
});

describe('withClears — PVE refuses a key that is set and deleted at once', () => {
  /**
   * ⛔ THE FAILURE THIS GUARDS. PVE::SectionConfig::delete_from_config line 1860 dies with
   *   "cannot set and delete property '$k' at the same time!" when the key is `defined` in the
   *   body — and `'0'` is defined. Six families built this form by hand before it was extracted.
   */
  it('drops a cleared key from the body rather than sending both', () => {
    const form = withClears({ comment: 'x', strict: '0' }, ['strict']);
    assert.equal(form['strict'], undefined, 'strict must not be SET while it is being deleted');
    assert.equal(form['delete'], 'strict');
    assert.equal(form['comment'], 'x');
  });

  it("treats the empty string as set, because PVE's test is `defined` and not truth", () => {
    const form = withClears({ comment: '' }, ['comment']);
    assert.equal(form['comment'], undefined);
    assert.equal(form['delete'], 'comment');
  });

  /** ⚠️ No clears means no `delete` key at all — an empty one would be a parameter PVE rejects. */
  it('omits delete entirely when nothing is cleared', () => {
    const form = withClears({ comment: 'x' }, []);
    assert.equal(form['delete'], undefined);
    assert.deepEqual(form, { comment: 'x' });
  });

  /** ⚠️ An undefined value is dropped, or URLSearchParams would send the text "undefined". */
  it('drops undefined values instead of stringifying them', () => {
    assert.deepEqual(withClears({ a: undefined, b: 'y' }, []), { b: 'y' });
  });
});
