/**
 * `pinProblems` — everything wrong with a declaration's pins alone, as plain strings, checked
 * before a plan resolves a directory or a host is asked anything. Split out of binary-form.ts
 * 2026-09-23 to keep that file under the house's 250-line cap (it was 229, heading for ~250 once
 * `archive.root` needed its own validation and JSDoc). binary-form.ts re-exports `pinProblems` and
 * `MAX_ARCHIVE`, so nothing that imported them moves.
 */
import type { ReleaseArchive } from './binary-form.ts';

const HEX64 = /^[0-9a-f]{64}$/;
export const MAX_ARCHIVE = 1 << 30;
// ⛔ Strict on purpose: each is written into a URL or a path. GitHub's own owner and name alphabet.
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;
const SEGMENT = /^[A-Za-z0-9._-]+$/;
// ★ ONLY WHAT THE READER HANDLES: a gzipped tar. A `.zip` or a bare binary is a new capability
//   with its own walk-down, not a name this should accept and then fail to unpack.
const TARBALL = /\.(tar\.gz|tgz)$/;

/** A single path segment that cannot climb, hide or name the directory itself. */
const segmentProblem = (what: string, value: string): string | undefined =>
  !SEGMENT.test(value) || value === '.' || value === '..'
    ? `${what} must be one path segment of letters, digits, '.', '_' or '-': ${JSON.stringify(value)}`
    : undefined;

/** Everything wrong with the pins alone — plain strings in any declaration, resolved or not. */
export const pinProblems = (props: {
  readonly archive?: Partial<ReleaseArchive>;
  readonly member?: unknown;
  readonly sha256?: unknown;
  readonly name?: unknown;
}): string[] => {
  const archive = props.archive ?? {};
  const found: string[] = [];
  const text = (what: string, value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    found.push(`${what} is required, as a plain string`);
    return undefined;
  };
  const repo = text('archive.repo', archive.repo);
  // ⚠️ `owner/..` passes the alphabet, and a URL parser normalises it away: the request would go
  //   to `github.com/releases/…`, somewhere nobody pinned. Refused by name.
  const repoName = repo?.slice(repo.indexOf('/') + 1);
  if (repo !== undefined && (!REPO.test(repo) || repoName === '.' || repoName === '..'))
    found.push(`archive.repo must be "owner/name": ${JSON.stringify(repo)}`);
  for (const [what, value] of [
    ['archive.tag', archive.tag],
    ['name', props.name],
  ] as const) {
    const given = text(what, value);
    const problem = given === undefined ? undefined : segmentProblem(what, given);
    if (problem !== undefined) found.push(problem);
  }
  const asset = text('archive.asset', archive.asset);
  if (asset !== undefined) {
    const problem = segmentProblem('archive.asset', asset);
    if (problem !== undefined) found.push(problem);
    else if (!TARBALL.test(asset))
      found.push(`archive.asset must be a .tar.gz or .tgz: "${asset}"`);
  }
  // ★ ONE DECLARED DIRECTORY, NEVER DERIVED. Optional: most archives (Victoria, OpenBao) are flat.
  //   Where given, it is the vendor's own wrapper (measured, not guessed — tar.ts's header comment)
  //   and must be exactly one safe segment, the same alphabet as a tag or an asset name.
  if (archive.root !== undefined) {
    if (typeof archive.root !== 'string') {
      found.push('archive.root must be a plain string when given');
    } else {
      const problem = segmentProblem('archive.root', archive.root);
      if (problem !== undefined) found.push(problem);
    }
  }
  // ⛔ THE SIZE IS ALLOCATED UP FRONT (download.ts fills one buffer of exactly this many bytes), so
  //   a typo'd size is a memory bomb in the deploying process. vmutils, the largest archive pinned,
  //   is 123.6 MB; a gibibyte is a ceiling nothing single-binary should reach.
  const size = archive.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_ARCHIVE) {
    found.push(`archive.size must be the asset's byte count, 1 to ${String(MAX_ARCHIVE)}`);
  }
  for (const [what, value] of [
    ['archive.sha256', archive.sha256],
    ['sha256', props.sha256],
  ] as const) {
    const given = text(what, value);
    if (given !== undefined && !HEX64.test(given))
      found.push(`${what} must be 64 lower-case hex digits`);
  }
  const member = text('member', props.member);
  // ⛔ The tar reader refuses these entries anyway; asking for one is a mistake to name at plan.
  if (
    member !== undefined &&
    (member === '' || member.startsWith('/') || member.split('/').includes('..'))
  ) {
    found.push(`member must be a relative name inside the archive: ${JSON.stringify(member)}`);
  }
  return found;
};
