/**
 * ⚠️ TEST SEAM for talosctl-binary.ts's ancestor walk. Plain syntax on purpose: fake-process.ts
 *   imports it and is loaded under Node's strip-only TypeScript (node-connect.harness.ts), which
 *   cannot load talosctl-binary.ts (parameter properties). Not exported from the subpath index.
 *
 *   The offline fakes keep their stub binary in a private temp dir whose ancestors (a CI scratch
 *   root, a shared `TMPDIR`) the suite does not own, so the walk stops AT a registered directory.
 *   Production never registers one, and every directory from the binary up to the boundary is
 *   still vetted.
 */
import { realpathSync } from 'node:fs';

export const trustBoundaries: Set<string> = new Set<string>();

export const trustBoundaryForTests = (dir: string): void => {
  trustBoundaries.add(realpathSync(dir));
};
