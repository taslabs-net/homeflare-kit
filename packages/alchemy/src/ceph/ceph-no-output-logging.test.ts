/**
 * The design doc's own Risks section (docs/plans/2026-09-26-ceph-mon-transport.md) says this
 * family "gets a structural test over its own source (no output-logging)". LAND red team
 * (2026-09-26): no such test existed — the fake-runner tests proved the key never reaches a log
 * line for the SHAPES they happened to exercise, but nothing proved a future call site could not
 * add a new one that does. This is that test, the same grep-gate shape
 * `talos/secrets-gate.test.ts` runs for PEM/bootstrap-token material.
 *
 * ★ A POSITIVE CONTROL WOULD DEFEAT THE PURPOSE HERE, same as secrets-gate.test.ts: there is no
 *   "real" case where a hit should be found, so this only has a negative case.
 * ⚠️ THIS IS A TEXT SCAN, NOT A TYPE CHECKER. It cannot prove no code path ever COULD log output —
 *   only that today's source doesn't. ceph-transport.ts's own header comment carries the actual
 *   invariant ("ONLY ARGV IS EVER LOGGED"); this test is the regression guard for it.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CEPH_DIR = import.meta.dir;

/** This family's own production source — never a test file, never the fake dial's test double. */
const productionFiles = () =>
  readdirSync(CEPH_DIR)
    .filter(
      (name) => name.endsWith('.ts') && !name.includes('.test.') && name !== 'fake-ceph-dial.ts',
    )
    .map((name) => join(CEPH_DIR, name));

describe('no output-logging — structural test over this family’s own source', () => {
  test('no console.* call anywhere — logging goes only through the injected `log` sink', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\bconsole\.\w+\(/);
    }
  });

  test('every call to the injected `log` sink logs the attempted argv line only, never stdout/stderr/a key', () => {
    let sawACall = false;
    for (const file of productionFiles()) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!/\blog\(/.test(line)) continue;
        sawACall = true;
        expect(line).not.toMatch(/\.stdout\b/);
        expect(line).not.toMatch(/\.stderr\b/);
        expect(line).not.toMatch(/\bkey\b/i);
      }
    }
    // ⛔ A GUARD AGAINST THE GUARD GOING QUIET. If this ever finds zero call sites (the log call
    //   renamed, the file moved), the two checks above would trivially pass having proven nothing.
    expect(sawACall).toBe(true);
  });
});
