/**
 * The per-request marks a seat puts on every LiteLLM call, applied as an `HttpClient`
 * transform because `@effect/ai-openai-compat` gives no other place to set them.
 *
 * ★ WHY A TRANSFORM AND NOT MODEL CONFIG. The compat mapper forwards unknown config keys
 *   into the body but DROPS `metadata` (it is a known Responses-API field with no
 *   chat-completions place), and no config key can set a header. Measured in
 *   packages/seat-runtime/tests/stamp.test.ts against the installed rc.115.
 * ★ IT IS THE SAME TRANSFORM AS cf-harness (landscape PR 165, cf-harness/src/request.ts),
 *   which is where the header and the body fields were measured against LiteLLM.
 */
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';

export type SeatStamp = {
  /** Already validated and joined: LiteLLM reads one comma-separated header. */
  readonly tags: string;
  readonly noCache: boolean;
  readonly metadata: Readonly<Record<string, string>> | undefined;
};

/**
 * ⛔ A TAG IS A TOKEN, NOT A SENTENCE. LiteLLM splits `x-litellm-tags` on commas and this
 *   package joins with them, so a comma inside a tag would silently become two tags, and a
 *   control character in a header value is header injection. Printable ASCII, no comma, no
 *   space; `host:ct100` and `seat:cf-coding` are the shape.
 */
const TAG = /^[\x21-\x2b\x2d-\x7e]{1,128}$/;

/** Validate and join. Throws at layer construction, where the mistake is one line away. */
export function joinTags(tags: string | ReadonlyArray<string>): string {
  const list = typeof tags === 'string' ? tags.split(',') : [...tags];
  if (list.length === 0) throw new TypeError('seat tags: at least one tag is required');
  for (const tag of list) {
    if (!TAG.test(tag)) {
      throw new TypeError(
        `seat tags: ${JSON.stringify(tag)} is not a tag (1-128 printable ASCII, no comma or space)`,
      );
    }
  }
  return list.join(',');
}

/** The JSON body as an object, or undefined for anything this must leave alone. */
function jsonObject(
  request: HttpClientRequest.HttpClientRequest,
): Record<string, unknown> | undefined {
  const body = request.body;
  if (body._tag !== 'Uint8Array' || !body.contentType.includes('json')) return undefined;
  // ⚠️ `text` is only "the original text retained for adapters that can skip encoding"
  //   (HttpBody.d.ts): a body built from bytes has none. Decoding the bytes keeps the stamp
  //   from becoming a silent no-op, which is the failure that would leave the LiteLLM cache
  //   ON for a seat that asked for it off.
  const text = body.text ?? new TextDecoder().decode(body.body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  return parsed as Record<string, unknown>;
}

/** Headers and body fields for one request. Pure: the same request in, a new one out. */
export function stampRequest(
  request: HttpClientRequest.HttpClientRequest,
  stamp: SeatStamp,
): HttpClientRequest.HttpClientRequest {
  const headers = stamp.noCache
    ? { 'x-litellm-tags': stamp.tags, 'cache-control': 'no-cache, no-store' }
    : { 'x-litellm-tags': stamp.tags };
  const tagged = HttpClientRequest.setHeaders(request, headers);
  const body = jsonObject(request);
  if (body === undefined) return tagged;
  return HttpClientRequest.bodyJsonUnsafe(tagged, {
    ...body,
    // ⚠️ THE HEADER ALONE DOES NOT TURN THE CACHE OFF. Measured 2026-09-25 (cf-review PR 22,
    //   LiteLLM 1.100.0): `cache: {"no-cache": true}` skips the read and `"no-store": true`
    //   skips the write; `caching: false` in the body is a no-op, and a repeat answered from
    //   the cache reads as agreement. The Cache-Control header is sent as well, for the
    //   Cloudflare AI Gateway below LiteLLM, and is not what LiteLLM honours.
    ...(stamp.noCache ? { cache: { 'no-cache': true, 'no-store': true } } : {}),
    // ★ ZERO, ALWAYS. A seat retries in Effect, where the attempt is a span; LiteLLM retrying
    //   behind it would multiply attempts invisibly (and bill each one).
    num_retries: 0,
    ...(stamp.metadata !== undefined && !('metadata' in body) ? { metadata: stamp.metadata } : {}),
  });
}
