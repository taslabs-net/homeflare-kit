/**
 * Which directories the talosctl ancestor walk (talosctl-binary.ts) may stop above.
 *
 * ⛔ READ-ONLY SHIPPED SURFACE, TEST-ONLY BY CONSTRUCTION. This is the only module the walk
 *   consults, and its only export is the query below — the register function lives in
 *   `trust-boundary.seam.ts`, which the published tarball does not contain (package.json `files`
 *   excludes it; scripts/smoke.ts asserts that). A non-test import of this module therefore
 *   cannot stop the walk early: `trustBoundaryForTests` is unreachable, the set it feeds is not
 *   exported, and in a consumer install the dynamic pull below finds no seam, keeps the empty
 *   set and every ancestor of a binary is vetted (fail closed). The seam is pulled with a
 *   COMPUTED specifier so no bundler inlines it into the shipped module.
 *
 *   Plain syntax on purpose: fake-process.ts's graph is loaded under Node's strip-only
 *   TypeScript (node-connect.harness.ts), which cannot load talosctl-binary.ts (parameter
 *   properties). Not exported from the subpath index.
 */
import { realpathSync } from 'node:fs';

let boundaries: ReadonlySet<string> = new Set<string>();

/**
 * Canonical compare: the walk hands over a real path, but the boundary is a security decision —
 * resolving again makes it independent of what a caller (now or future) cached. ⛔ A directory
 * that cannot be resolved is answered FALSE, never thrown: it is certainly not a registered
 * boundary, and the walk must treat "no boundary" as "vet everything" (fail closed).
 */
export const isTrustedBoundary = (dir: string): boolean => {
  try {
    return boundaries.has(realpathSync(dir));
  } catch {
    return false;
  }
};

const seamSpecifier = './trust-boundary' + '.seam.ts';
void import(seamSpecifier).then(
  (seam: { boundaries: ReadonlySet<string> }) => {
    boundaries = seam.boundaries;
  },
  () => {
    // Published package: no seam in the tarball — the set stays empty and the walk is never
    // shortened. In-repo this only fires if the seam file was deleted; boundary-dependent tests
    // then fail loudly instead of passing short-handed.
  },
);
