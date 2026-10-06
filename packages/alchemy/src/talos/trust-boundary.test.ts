/**
 * The shipped trust-boundary surface. ⛔ The talosctl ancestor walk stops early above a
 * registered directory, so anything that can register a directory can switch that vetting off —
 * the module a consumer imports must therefore offer no way to register one. The register
 * function lives in trust-boundary.seam.ts, which the published tarball excludes (package.json
 * `files`, asserted by scripts/smoke.ts), so a non-test import of this module cannot reach it.
 */
import { expect, test } from 'bun:test';
import * as shipped from './trust-boundary.ts';

test('the shipped module exposes only the read-only boundary query', () => {
  expect(Object.keys(shipped).sort()).toEqual(['isTrustedBoundary']);
});

test('isTrustedBoundary answers false for an unregistered directory', () => {
  expect(shipped.isTrustedBoundary('/definitely/not/registered')).toBe(false);
});
