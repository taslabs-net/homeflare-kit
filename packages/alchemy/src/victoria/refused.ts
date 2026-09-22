/**
 * Victoria.Binary's failures as typed errors, so a caller can `catchTag` the one it expects — each
 * carrying the house refusal sentence (`Victoria.Binary <path>: …`) as its `message`.
 *
 * ★ TYPED BECAUSE ALCHEMY UPSTREAM REQUIRES IT (its AGENTS.md at v2.0.0-beta.79: Data.TaggedError,
 *   `catchTag`, never a cast on `_tag`), and a provider written to be contributed should not need
 *   its error channel rewritten to get there. The MESSAGE stays the kit's wording, so a deploy log
 *   reads the same as every other house family's.
 * ★ THE TAGS ARE GENERIC ON PURPOSE. Downloading a pinned archive, refusing an unsafe one and
 *   comparing digests have nothing Victoria-specific in them (docs/victoria-upstream.md).
 */
import * as Data from 'effect/Data';

/** The declaration itself: an unknown version, a bad path or mode, a pin that disagrees. */
export class BinaryRefused extends Data.TaggedError('BinaryRefused')<{
  readonly message: string;
}> {}

/** The download: a status that is not 200, a body that is not the pinned size, a dead transport. */
export class DownloadFailed extends Data.TaggedError('DownloadFailed')<{
  readonly message: string;
  /** Worth another attempt: a transport failure or a 5xx, never a wrong size or a 404. */
  readonly retryable: boolean;
}> {}

/** Bytes that do not hash to their pin — the archive, or a member extracted from it. */
export class ChecksumMismatch extends Data.TaggedError('ChecksumMismatch')<{
  readonly message: string;
  readonly subject: string;
  readonly expected: string;
  readonly actual: string;
}> {}

/** An archive this reader will not trust: an unsafe or unexpected entry, a missing member. */
export class ArchiveRefused extends Data.TaggedError('ArchiveRefused')<{
  readonly message: string;
}> {}
