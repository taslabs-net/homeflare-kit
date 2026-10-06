/**
 * ⚠️ TEST-ONLY SEAM for talosctl-binary.ts's ancestor walk. Plain syntax on purpose: fake-process.ts
 *   imports it and is loaded under Node's strip-only TypeScript (node-connect.harness.ts), which
 *   cannot load talosctl-binary.ts (parameter properties).
 *
 * ⛔ NOT IN THE PUBLISHED TARBALL. package.json `files` excludes this file and scripts/smoke.ts
 *   asserts the tarball carries none of it. The walk's boundary state lives HERE, and every
 *   importable path to a register function dies with it, so a consumer who imports the shipped
 *   trust-boundary.ts finds only a read-only query and can never stop the walk early. In a
 *   consumer install the module below is absent, the shipped set stays empty and every ancestor
 *   of a binary is vetted (fail closed).
 *
 *   The offline fakes keep their stub binary in a private temp dir whose ancestors (a CI scratch
 *   root, a shared `TMPDIR`) the suite does not own, so the walk stops AT a registered directory.
 *   Production never registers one, and every directory from the binary up to the boundary is
 *   still vetted.
 */
import { realpathSync } from 'node:fs';

const set = new Set<string>();

/** The set the shipped walk consults (read-only view). Boundaries are stored canonical. */
export const boundaries: ReadonlySet<string> = set;

export const trustBoundaryForTests = (dir: string): void => {
  set.add(realpathSync(dir));
};
