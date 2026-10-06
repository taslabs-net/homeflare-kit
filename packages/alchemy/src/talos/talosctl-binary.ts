/**
 * Which `talosctl` runs, and whether that file may be trusted with the vault-minted talosconfig.
 * Extracted from talosctl.ts (250-line cap).
 *
 * ⛔ A VETTING REFUSAL IS NOT A TalosError. `TalosError` means a `talosctl` run completed and
 *   exited non-zero — the one outcome `Talos.ClusterHealth` may call "not healthy", and the one
 *   `talosctlOrAlready` pattern-matches. A refused binary never ran, so it is its own class and
 *   propagates through both untouched (hunt round 6: it read as `healthy: false`).
 */
import { accessSync, constants, lstatSync, realpathSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';
import * as Effect from 'effect/Effect';
import { isTrustedBoundary } from './trust-boundary.ts';

/** `talosctl` on `PATH`. A lane pins another build with {@link TALOSCTL_BINARY_ENV} or `binary`. */
export const DEFAULT_TALOSCTL_BINARY = 'talosctl';

/**
 * Executable override, read at call time. The Mac PATH measured 2026-10-05 has v1.13.8; the
 * cluster is v1.14.2. Set this to the v1.14.2 binary. A per-call `binary` option wins.
 */
export const TALOSCTL_BINARY_ENV = 'HF_TALOSCTL';

export class TalosBinaryRefused extends Error {
  constructor(
    readonly command: string,
    detail: string,
    readonly binary = DEFAULT_TALOSCTL_BINARY,
  ) {
    super(`${binary} ${command} refused: ${detail}`);
    this.name = 'TalosBinaryRefused';
  }
}

/**
 * ⛔ THE DEFAULT IS VETTED TOO (hunt round 5): a bare `talosctl` is resolved against `PATH` here
 *   (not `Bun.which` — the published dist runs on Node, where that global is missing), symlinks are
 *   followed, and the REAL file is vetted, version-checked and executed by absolute path.
 */
export const resolveDefault = (binary: string) =>
  Effect.try({
    try: () => {
      for (const entry of (process.env['PATH'] ?? '').split(delimiter)) {
        if (!isAbsolute(entry)) continue;
        try {
          const candidate = join(entry, binary);
          accessSync(candidate, constants.X_OK);
          return realpathSync(candidate);
        } catch {
          // not in this PATH entry — try the next
        }
      }
      throw new Error('not found');
    },
    catch: () => new TalosBinaryRefused('binary check', `${binary} was not found on PATH`, binary),
  });

/**
 * ⛔ EVERY DIRECTORY ON THE CANONICAL PATH must belong to the current user or root and must not be
 *   group/world-writable (unless sticky: a sticky directory's entries cannot be renamed by others).
 *   Round 5 checked only the immediate parent's mode, so an attacker-owned 0755 parent, or a
 *   writable ancestor, could swap the file after the check. Returns the refusal reason, or
 *   undefined when the whole chain is trusted.
 */
const untrustedAncestor = (file: string, uid: number | undefined): string | undefined => {
  let dir = realpathSync(dirname(file));
  for (;;) {
    const stat = lstatSync(dir);
    // The boundary directory itself is still vetted; only what lies ABOVE it is not (test seam,
    // trust-boundary.seam.ts, which the published tarball does not carry).
    const isBoundary = isTrustedBoundary(dir);
    if (uid !== undefined && stat.uid !== uid && stat.uid !== 0) {
      return `lives under a directory owned by another user (${dir})`;
    }
    const sticky = (stat.mode & 0o1000) !== 0;
    if ((stat.mode & 0o022) !== 0 && !sticky) {
      return `lives in a group- or world-writable directory (${dir})`;
    }
    const up = dirname(dir);
    if (up === dir || isBoundary) return undefined;
    dir = up;
  }
};

/**
 * ⛔ THE BINARY GETS THE VAULT-MINTED TALOSCONFIG: absolute, owned, not writable, executable, trusted
 *   path. ⛔ RETURNS THE CANONICAL PATH (round 7): the override's directory is resolved ONCE
 *   (realpath), that path and every ancestor of it are vetted, and the caller must launch exactly
 *   the returned path for the version probe AND the credential-bearing call. Vetting the given path
 *   and executing it again let a symlinked ancestor be repointed between the two launches. The leaf
 *   itself is still lstat'd, so a symlink leaf is refused rather than followed.
 */
export const checkBinaryPath = (binary: string, source: string) => {
  const refuse = (why: string) =>
    Effect.fail(new TalosBinaryRefused('binary check', `${source} ${why}`, binary));
  if (!isAbsolute(binary)) return refuse('must be an absolute path');
  return Effect.try({
    try: () => {
      const canonical = join(realpathSync(dirname(binary)), basename(binary));
      const file = lstatSync(canonical);
      const uid = process.getuid?.();
      return { canonical, file, uid, ancestor: untrustedAncestor(canonical, uid) };
    },
    catch: () => new TalosBinaryRefused('binary check', `${source} is not a readable file`, binary),
  }).pipe(
    Effect.flatMap(({ canonical, file, uid, ancestor }) => {
      // ★ lstat, not stat: a symlink can be re-pointed by whoever owns the link, so none is accepted.
      if (file.isSymbolicLink()) return refuse('must not be a symlink');
      if (!file.isFile()) return refuse('is not a regular file');
      // ⛔ FAIL CLOSED: with no process uid (a platform lacking getuid) ownership cannot be checked.
      if (uid === undefined) return refuse('cannot be vetted: no process uid to check ownership');
      if (ancestor !== undefined) return refuse(ancestor);
      if (uid !== undefined && file.uid !== uid && file.uid !== 0) {
        return refuse('must be owned by the current user or root');
      }
      if ((file.mode & 0o022) !== 0) return refuse('is group- or world-writable');
      try {
        accessSync(canonical, constants.X_OK);
      } catch {
        return refuse('is not executable');
      }
      return Effect.succeed(canonical);
    }),
  );
};
