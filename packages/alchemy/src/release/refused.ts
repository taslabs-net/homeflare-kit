/**
 * Release.Binary's failures as tagged errors — each carrying the house refusal sentence
 * (`Release.Binary <path>: …`) as its `message`.
 *
 * ★ TAGGED BECAUSE ALCHEMY UPSTREAM REQUIRES IT (its AGENTS.md at v2.0.0-beta.79: Data.TaggedError,
 *   `catchTag`, never a cast on `_tag`), so the classes need no rewrite on the way there. The
 *   MESSAGE stays the kit's wording, so a deploy log reads the same as every other house family's.
 * ⚠️ TAGGED IS NOT YET TYPED END TO END — measured in error-channel.test.ts. catalogBinary() throws,
 *   so in a stack program its BinaryRefused is a DEFECT that `catchTag` never sees; and the provider
 *   runs every lifecycle call through the house `lift()`, which keeps the instance at runtime but
 *   types the channel as `Error`. No caller can name one of these tags today without a cast.
 * ★ THE TAGS NAME NO VENDOR. Downloading a pinned archive, refusing an unsafe one and comparing
 *   digests are the same for every catalog (docs/release-binary-upstream.md).
 */
import * as Data from 'effect/Data';

/** The declaration itself: a version no catalog pins, a malformed pin, a bad path or mode. */
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
