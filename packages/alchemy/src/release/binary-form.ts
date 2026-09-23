/**
 * Release.Binary's props, attributes and validation — the pure half of the provider.
 *
 * ★ THE PINNED ARCHIVE IS A PROP, NOT A LOOKUP. Repository, tag, exact asset name, size, the
 *   archive's SHA-256, the member and the member's SHA-256 all arrive as props — usually spread from
 *   a vendor data set (victoria.ts) by `catalogBinary()`. So the resource knows no vendor at all: a
 *   second vendor is a second data module, never a change here, and the resource is the shape
 *   Alchemy could accept (docs/release-binary-upstream.md).
 * ⛔ NOTHING ESTATE-SPECIFIC IS A CONSTANT HERE. The install directory, owner, group and mode are
 *   the consuming stack's props. A stack that keeps binaries under `/opt/<estate>/obs/bin` says so
 *   in its own code.
 * ⛔ EVERY PIN IS REQUIRED, AND WELL-FORMED OR REFUSED. There is no "latest", no optional digest and
 *   no fallback to a checksum file fetched at apply — see victoria.ts for why a pin beats a fetch.
 */
import type { HostFileAttributes } from '../launchd/host-file-form.ts';
import { identityProblems, pathProblems } from '../launchd/host-file-form.ts';

/** One release archive, pinned: where it is published, and the bytes it must be. */
export interface ReleaseArchive {
  /** The GitHub repository that publishes it, `owner/name`: `'VictoriaMetrics/VictoriaMetrics'`. */
  readonly repo: string;
  /** The release tag, exactly as published: `'v1.151.0'`. */
  readonly tag: string;
  /**
   * The asset's file name, whole: `'vmutils-darwin-arm64-v1.151.0.tar.gz'`. ⛔ Never a prefix or a
   * pattern — `-enterprise` and `-cluster` siblings share every prefix with it.
   */
  readonly asset: string;
  /** Bytes, per the release API. A download that runs past this is cut off and refused. */
  readonly size: number;
  /** The archive's SHA-256, lower-case hex, as the vendor's checksum file lists it. */
  readonly sha256: string;
}

export interface ReleaseBinaryProps {
  /** The pinned archive the binary comes out of. `catalogBinary()` fills it from a data set. */
  archive: ReleaseArchive;
  /** The archive member to extract, by its exact name: `'vmalert-prod'`. Nothing else is unpacked. */
  member: string;
  /** The member's own SHA-256 — what the installed file must hash to. */
  sha256: string;
  /**
   * The installed file name: `'vmalert'`. ★ Separate from `member` on purpose — VictoriaMetrics
   * names every member `<binary>-prod`, and a job's argv[0] should not carry that.
   */
  name: string;
  /**
   * The directory the binary is written into. ⛔ It must already exist — declare it with
   * `HostDirectory` and pass that resource's `path`, which also orders it first. ★ Give each
   * version its own directory (`catalogDirectory()`): an upgrade is then a new path — a
   * create-before-delete replace, never an overwrite under a running daemon — and a rollback is a
   * path. A new pin at the SAME path is refused (binary-diff.ts).
   */
  directory: string;
  /**
   * Permission bits. ⛔ Owner-readable and -executable, never group- or world-writable, never
   * setuid, setgid or sticky — a writable binary is whoever-can-write's code, run as whoever runs
   * the daemon. Its directory must not be group- or world-writable either (binary-lifecycle.ts).
   * @default 0o755
   */
  mode?: number;
  /** User name or numeric uid. Omitted: whoever the runner writes as. */
  owner?: string | number;
  /** Group name or numeric gid. Omitted: the directory's default group. */
  group?: string | number;
}

export interface ReleaseBinaryAttributes extends HostFileAttributes {
  /** The archive the bytes came from, whole. */
  url: string;
  /** The archive member installed, by its exact name: `vmalert-prod`. */
  member: string;
}

/** Everything a download and its two checks need: one archive, one member, both digests. */
export type PinnedDownload = {
  readonly url: string;
  readonly size: number;
  /** The archive's pinned SHA-256. */
  readonly sha256: string;
  /** The archive member to extract, by exact name. */
  readonly member: string;
  /** The member's pinned SHA-256. */
  readonly memberSha256: string;
};

export const DEFAULT_BINARY_MODE = 0o755;

/**
 * The release-asset URL. ★ GITHUB'S DOWNLOAD PATH, NOT THE API: it needs no token and spends no rate
 *   limit (it redirects to a signed CDN URL — measured 2026-09-22 with HEAD). Every consumer the
 *   estate census found publishes on GitHub except Grafana (grafana.com), which is not a
 *   single-binary consumer anyway (docs/release-binary-catalogs.md). A second source kind arrives
 *   with its first consumer, not before.
 */
export const releaseUrl = (repo: string, tag: string, asset: string): string =>
  `https://github.com/${repo}/releases/download/${tag}/${asset}`;

/** Where a declaration puts its binary: `<directory>/<name>`. */
export const releaseBinaryPath = (props: {
  readonly directory: string;
  readonly name: string;
}): string => `${props.directory}/${props.name}`;

/** The download a declaration means. ⚠️ Validate first (binaryProblems): this trusts its input. */
export const pinnedDownload = (props: ReleaseBinaryProps): PinnedDownload => ({
  member: props.member,
  memberSha256: props.sha256,
  sha256: props.archive.sha256,
  size: props.archive.size,
  url: releaseUrl(props.archive.repo, props.archive.tag, props.archive.asset),
});

export const modeProblems = (mode: number): string[] => {
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777) return ['mode must be 0–0o7777'];
  const found: string[] = [];
  if ((mode & 0o7000) !== 0) found.push('mode must not set setuid, setgid or sticky');
  if ((mode & 0o022) !== 0) found.push('mode must not be group- or world-writable');
  if ((mode & 0o100) === 0) found.push('mode must let the owner execute it');
  // ⛔ AND READ IT: every plan re-hashes the binary, and a write is read back. MEASURED 2026-09-22,
  //   an execute-only 0111 written by a non-root operator failed its read-back with EACCES.
  if ((mode & 0o400) === 0) found.push('mode must let the owner read it (it is re-hashed)');
  return found;
};

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

const ARCHIVE_KEYS = ['repo', 'tag', 'asset', 'size', 'sha256'] as const;

type Pins = Pick<ReleaseBinaryProps, 'archive' | 'member' | 'sha256'>;

/** Whether two declarations pin different bytes: another archive, member or member digest. */
export const pinsMoved = (olds: Pins, news: Pins): boolean =>
  olds.member !== news.member ||
  olds.sha256 !== news.sha256 ||
  ARCHIVE_KEYS.some((key) => olds.archive[key] !== news.archive[key]);

/**
 * ⛔ A NEW PIN IS A NEW PATH. The same path with other bytes would overwrite a binary under the
 *   daemon running it, and leave no rollback but a re-download — so it is refused, at plan when the
 *   path is resolved (binary-diff.ts) and at apply otherwise (binary-lifecycle.ts).
 */
export const inPlaceRefusal = (olds: Pins, news: Pins): string =>
  `a new pin (${news.archive.tag} ${news.member} ${news.sha256}) at the path of the installed ` +
  `one (${olds.archive.tag} ${olds.member} ${olds.sha256}) would overwrite it in place; give each ` +
  'version its own directory (catalogDirectory), so an upgrade is a new path';

/** Everything wrong with a declaration, before any host or network is asked anything. */
export const binaryProblems = (props: ReleaseBinaryProps): string[] => [
  ...pinProblems(props),
  ...pathProblems(props.directory).map((problem) => `directory: ${problem}`),
  ...modeProblems(props.mode ?? DEFAULT_BINARY_MODE),
  ...identityProblems('owner', props.owner),
  ...identityProblems('group', props.group),
];
