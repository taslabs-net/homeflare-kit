/**
 * The download over a fake `HttpClient` — no network: status first, the body against the pinned
 * size, bounded retries only where another attempt could help, and one download shared by the
 * resources that need the same archive at the same time.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientError from 'effect/unstable/http/HttpClientError';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import { type FetchArchive, httpFetchArchive, sharingInFlight } from './download.ts';
import { bytesOf } from './fake-release.ts';
import { DownloadFailed } from './refused.ts';

const URL_A = 'https://example.invalid/a.tar.gz';
const FAST = { retries: 2, spacing: '1 millis', timeout: '5 seconds' } as const;

/** A client that answers each request with the next scripted reply, recording every URL. */
const scripted = (...replies: Array<{ status: number; body?: Uint8Array }>) => {
  const urls: string[] = [];
  const client = HttpClient.make((request, url) => {
    urls.push(url.toString());
    const reply = replies[Math.min(urls.length, replies.length) - 1] ?? { status: 599 };
    const body = reply.body === undefined ? null : new Blob([reply.body.slice()]);
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(body, { status: reply.status })),
    );
  });
  return { fetch: httpFetchArchive(client, FAST), urls };
};

const failure = async (promise: Promise<unknown>): Promise<DownloadFailed> => {
  try {
    await promise;
  } catch (cause) {
    expect(cause).toBeInstanceOf(DownloadFailed);
    return cause as DownloadFailed;
  }
  throw new Error('expected DownloadFailed');
};

describe('downloadPinned', () => {
  test('200 with exactly the pinned size: the bytes', async () => {
    const body = bytesOf('archive');
    const { fetch, urls } = scripted({ body, status: 200 });
    expect(await fetch(URL_A, body.length)).toEqual(body);
    expect(urls).toEqual([URL_A]);
  });

  test('404 is final: one request, not retried', async () => {
    const { fetch, urls } = scripted({ status: 404 });
    const error = await failure(fetch(URL_A, 7));
    expect(error.message).toContain('HTTP 404');
    expect(error.retryable).toBe(false);
    expect(urls.length).toBe(1);
  });

  test('a 5xx is retried, twice and no more', async () => {
    const { fetch, urls } = scripted({ status: 503 });
    expect((await failure(fetch(URL_A, 7))).message).toContain('HTTP 503');
    expect(urls.length).toBe(3);
  });

  test('a 5xx then a good answer succeeds', async () => {
    const body = bytesOf('archive');
    const { fetch, urls } = scripted({ status: 502 }, { body, status: 200 });
    expect(await fetch(URL_A, body.length)).toEqual(body);
    expect(urls.length).toBe(2);
  });

  test('a body longer than the pin is cut off and refused, not retried', async () => {
    const { fetch, urls } = scripted({ body: bytesOf('x'.repeat(100)), status: 200 });
    expect((await failure(fetch(URL_A, 10))).message).toContain('runs past the pinned 10 bytes');
    expect(urls.length).toBe(1);
  });

  test('a short body is refused (and retried, as a cut-off transfer)', async () => {
    const { fetch, urls } = scripted({ body: bytesOf('abc'), status: 200 });
    expect((await failure(fetch(URL_A, 10))).message).toContain('3 bytes, the pin says 10');
    expect(urls.length).toBe(3);
  });

  test('a transport failure is a DownloadFailed with the reason, retried', async () => {
    const urls: string[] = [];
    const client = HttpClient.make((request, url) => {
      urls.push(url.toString());
      const reason = new HttpClientError.TransportError({
        description: 'connection reset',
        request,
      });
      return Effect.fail(new HttpClientError.HttpClientError({ reason }));
    });
    const error = await failure(httpFetchArchive(client, FAST)(URL_A, 7));
    expect(error.message).toContain('connection reset');
    expect(error.retryable).toBe(true);
    expect(urls.length).toBe(3);
  });

  test('no answer in time is final', async () => {
    const client = HttpClient.make(() => Effect.never);
    const fetch = httpFetchArchive(client, { ...FAST, timeout: '20 millis' });
    expect((await failure(fetch(URL_A, 7))).message).toContain('no complete response in time');
  });
});

describe('sharingInFlight', () => {
  test('two requests for one archive at once share one download; a later one downloads again', async () => {
    let calls = 0;
    let release: (bytes: Uint8Array) => void = () => undefined;
    const slow: FetchArchive = () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const fetch = sharingInFlight(slow);
    const first = fetch(URL_A, 3);
    const second = fetch(URL_A, 3);
    release(bytesOf('abc'));
    expect(await first).toBe(await second);
    expect(calls).toBe(1);
    const third = fetch(URL_A, 3);
    release(bytesOf('abc'));
    await third;
    expect(calls).toBe(2);
  });

  test('a failed download is not cached', async () => {
    let calls = 0;
    const fetch = sharingInFlight(async () => {
      calls += 1;
      throw new DownloadFailed({ message: 'nope', retryable: false });
    });
    await expect(fetch(URL_A, 1)).rejects.toBeInstanceOf(DownloadFailed);
    await expect(fetch(URL_A, 1)).rejects.toBeInstanceOf(DownloadFailed);
    expect(calls).toBe(2);
  });
});
