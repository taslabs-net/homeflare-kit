/**
 * What a Release.Binary may take over at a path it holds no state for: ONLY the pinned binary, and
 * only under `--adopt`. Asked the same way at plan (binary-diff.ts) and at apply
 * (binary-lifecycle.ts), so a plan never says `adopted` or `create` for a file the apply would then
 * overwrite or silently claim.
 *
 * ⛔ OTHER BYTES ARE NEVER ADOPTED, `--adopt` OR NOT. 🔴 MEASURED 2026-09-22 (adopt-parity.test.ts,
 *   through Alchemy's own Plan and Apply): under `--adopt`, a file with other bytes at the path
 *   planned as `adopted` — beta.79 forces an `adopted` update after every takeover and prints it for
 *   drift too — and the apply downloaded the archive and overwrote that file in place. With the
 *   directory an Output (the probe skipped) the same file planned as `create`, and was overwritten.
 *   ★ Refused rather than converged, which is what Host.File does with a file it adopts: a binary's
 *   content is named entirely by its pin, so "adopting" other bytes is replacing them under
 *   whatever runs them, with no rollback but a re-download — the very overwrite binary-form.ts
 *   inPlaceRefusal refuses for a re-pin. The pinned bytes with another mode or owner ARE adopted;
 *   the apply re-writes the bytes already on disk.
 * ⛔ THE PINNED BYTES WITH NO STATE ARE NOT OURS WITHOUT `--adopt` — AT APPLY AS AT PLAN. The probe
 *   already says `Unowned` for them (docs/ownership.md: identical is not ours). file-converge.ts
 *   accepts them at apply as the resume of an interrupted install, and that gap is where the probe
 *   never runs: every first deploy that passes `directory: dir.path`. 🔴 MEASURED 2026-09-22: a
 *   declaration renamed (a new logical id, the same path) in a deploy that also changed its
 *   HostDirectory's mode claimed the identical file at apply without `--adopt`; the orphan delete of
 *   the old name then removed it, and the deploy reported success with the binary gone. With the
 *   directory unchanged, the probe refused that same rename.
 *   ⚠️ THE COST: an install interrupted between its write and its commit while a prop was an
 *   Output now resumes only with `--adopt` — as the same install with every prop resolved already
 *   did (its recovery read is `Unowned`), and as ownership.md says a create or replace interrupted
 *   while a prop was an Output does. A retained old version is not re-claimed by a rollback either.
 *   ★ `renamedFrom()` IS THE REMEDY FOR A RENAME: `.pipe(renamedFrom('old-id'))` migrates the row
 *   and keeps the file (adopt-parity.test.ts). 🔴 MEASURED 2026-09-22: the same rename under
 *   `--adopt` claimed the file, the old name's delete then removed it, and the deploy succeeded
 *   with the binary gone. binary.ts's delete now leaves a path another declaration installed in
 *   the same deploy, so that is kept too — as an adoption, not as the old row. ⚠️ That guard sees
 *   only this deploy's claims, by spelling; nothing here sees another row's claim in state.
 * ★ HOW DIFF TELLS A TAKEOVER FROM ITS OWN ROW. Every row this resource commits records the digest
 *   reconcile READ BACK, which it checked equal to the pin — so `output.sha256 === olds.sha256` for
 *   every row of its own, and an update never changes the digest (a new digest is a new path, a
 *   `replace`). The engine hands diff anything else only after a read of a path it holds no state
 *   for: the adoption probe (`olds` = the declaration) or the recovery read of an interrupted
 *   create (`olds` = its row). A non-file reads with digest '' (file-converge.ts).
 */
import { type FileTarget, readFileAttributes } from '../launchd/file-converge.ts';
import type { HostRunner } from '../launchd/runner.ts';

const TAKEN = 'already exists and is not this resource';

const otherBytes = (found: string, pinned: string): string =>
  `${found === '' ? 'something that is not a regular file' : `a file hashing to ${found}`} is ` +
  `there, not the pinned binary (${pinned}). --adopt takes over only the pinned binary: taking ` +
  'over other bytes would overwrite them in place. Remove it (or move it aside) and deploy again';

/** Plan side: why diff must refuse `found` — a digest read at a path with no state — or undefined. */
export const adoptionProblem = (found: string, pinned: string): string | undefined =>
  found === pinned ? undefined : `${TAKEN}: ${otherBytes(found, pinned)}`;

/**
 * Apply side, for a reconcile with no `output` — a create, a replace's new generation, or the
 * resume of either: why it must not write, or undefined. `adopt` is adoptsAtApply's answer (never
 * true for a fresh replace). A symlink or directory is left to convergeFile, which refuses it by
 * kind.
 */
export const claimProblem = async (
  runner: HostRunner,
  want: FileTarget,
  adopt: boolean,
): Promise<string | undefined> => {
  const stat = await runner.stat(want.path);
  if (stat?.kind !== 'file') return undefined;
  const found = (await readFileAttributes(runner, want.path))?.sha256 ?? '';
  if (found !== want.sha256) return adoptionProblem(found, want.sha256);
  if (adopt) return undefined;
  return (
    `${TAKEN}: it holds the pinned binary, but this stack holds no state for it and the plan ` +
    'could not ask first (a prop was still an Output, or a replace landed on it). ' +
    'Identical is not ours: once claimed, a later delete removes it from whoever put it there. ' +
    'Deploy with --adopt to take it over (a create, or an interrupted install of this one), or ' +
    'remove it. If another declaration in this stack owned it under another name, declare the ' +
    'rename with renamedFrom() instead'
  );
};
