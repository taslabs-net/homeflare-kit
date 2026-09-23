/**
 * One pinned release archive over Effect's `HttpClient`: status first, then the body read against
 * the pinned size, into memory.
 *
 * ★ `HttpClient`, THE HOUSE TRANSPORT (openbao/bao-http.ts, decided 2026-09-14) and Alchemy's own:
 *   a typed error channel, interruption, and a client a test swaps for a fake. releaseProviders()
 *   provides `FetchHttpClient.layer` itself, so a host stack that has no HTTP layer yet (the Mac
 *   stack's has none) cannot forget it. ⚠️ fetch follows GitHub's 302 to its asset CDN (measured
 *   2026-09-22 with HEAD: a signed, expiring URL), so the status judged here is the CDN's.
 * ★ THE PINNED SIZE BOUNDS MEMORY. A body that runs past it is cut off at that byte, so a
 *   misbehaving server or a swapped asset cannot stream an unbounded file into the deploy.
 * ★ NO API CALL. The browser-download URL needs no token and spends no API rate limit; the pins
 *   say everything the release API would.
 * ⚠️ IN MEMORY: vmutils is 123.6 MB. Nothing is staged on disk, so no failure leaves a file behind.
 */
import type * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Schedule from 'effect/Schedule';
import * as Stream from 'effect/Stream';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import { DownloadFailed } from './refused.ts';

/** The provider's view of a transport: an archive's bytes by URL, never longer than `size`. */
export type FetchArchive = (url: string, size: number) => Promise<Uint8Array>;

/** How patient a download is. ★ Parameters so a test never waits for real. */
export type DownloadPolicy = {
  /** @default '10 minutes' — 123.6 MB on a slow link, and still a bounded wait. */
  readonly timeout?: Duration.Input;
  /** Retries after the first attempt, transport failures and 5xx only. @default 2 */
  readonly retries?: number;
  /** @default '2 seconds' */
  readonly spacing?: Duration.Input;
};

const failed = (message: string, retryable: boolean) => new DownloadFailed({ message, retryable });

const attempt = (url: string, size: number) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(url);
    if (response.status !== 200) {
      return yield* failed(`${url}: HTTP ${String(response.status)}`, response.status >= 500);
    }
    // ★ ONE BUFFER OF THE PINNED SIZE, filled in place: no chunk list and no concatenating copy,
    //   so the archive costs its own size in memory and not twice it.
    const archive = new Uint8Array(size);
    let total = 0;
    yield* Stream.runForEach(response.stream, (chunk) => {
      if (total + chunk.length > size) {
        return Effect.fail(failed(`${url}: runs past the pinned ${String(size)} bytes`, false));
      }
      archive.set(chunk, total);
      total += chunk.length;
      return Effect.void;
    });
    if (total !== size) {
      return yield* failed(`${url}: ${String(total)} bytes, the pin says ${String(size)}`, true);
    }
    return archive;
  }).pipe(
    // ⛔ `.message` only: it carries the reason, method and URL, and nothing else goes to the log.
    Effect.catchTag('HttpClientError', (cause) => Effect.fail(failed(cause.message, true))),
  );

/** The archive's bytes, exactly `size` of them, or DownloadFailed. */
export const downloadPinned = (
  url: string,
  size: number,
  policy: DownloadPolicy = {},
): Effect.Effect<Uint8Array, DownloadFailed, HttpClient.HttpClient> =>
  attempt(url, size).pipe(
    Effect.timeoutOrElse({
      duration: policy.timeout ?? '10 minutes',
      orElse: () => Effect.fail(failed(`${url}: no complete response in time`, false)),
    }),
    Effect.retry({
      schedule: Schedule.spaced(policy.spacing ?? '2 seconds'),
      times: policy.retries ?? 2,
      while: (error: DownloadFailed) => error.retryable,
    }),
  );

/** A FetchArchive over one HttpClient. ⚠️ Rejects with the DownloadFailed itself. */
export const httpFetchArchive =
  (client: HttpClient.HttpClient, policy: DownloadPolicy = {}): FetchArchive =>
  (url, size) =>
    Effect.runPromise(
      downloadPinned(url, size, policy).pipe(Effect.provideService(HttpClient.HttpClient, client)),
    );

/**
 * ★ ONE DOWNLOAD PER ARCHIVE AT A TIME, NOT ONE PER BINARY. vmagent and vmalert are two resources
 *   in one 123.6 MB archive, and Alchemy reconciles independent resources concurrently (its fan-out
 *   is unbounded, Apply.ts), so two requests for one URL share the download already in flight.
 *   The entry goes when it settles: a later request downloads again rather than pinning 123 MB in
 *   memory for the rest of the deploy.
 * ⚠️ The buffer is shared, so nothing downstream may write into it (archive.ts only reads).
 */
export const sharingInFlight = (fetch: FetchArchive): FetchArchive => {
  const inFlight = new Map<string, Promise<Uint8Array>>();
  return (url, size) => {
    const key = `${String(size)} ${url}`;
    const running = inFlight.get(key);
    if (running !== undefined) return running;
    const started = fetch(url, size).finally(() => inFlight.delete(key));
    inFlight.set(key, started);
    return started;
  };
};
