/**
 * Jev version-mismatch guard for the gateway transport (see ./gateway.ts and
 * ./gateway-map.ts): refuses, rather than silently answering with a different model,
 * when a caller names an explicit (non-alias) version and Cloudflare's catalog route
 * answers with a different one. Decision 23 (Tim, 2026-09-23).
 *
 * ★ MEASURED 2026-09-23, docs.typesafe.ai/models.md (fetched live, sha256
 *   9d20bb3c90a0147532d0b20ddc4c64579391be7842e965543b27bad684eeb4d6): the only two
 *   aliases TypeSafe publishes are `jev-latest` (the SDK's own default) and
 *   `jev-preview` (currently identical — "no preview build is available right now").
 *   Every other string — including a versioned id such as `jev-1.13.0`, and including
 *   an unknown near-miss such as `jev-1.13` — is treated as an explicit pin: an
 *   exact-string request the caller means literally, not "whatever the current release
 *   is called". "An alias moves when a new release ships... pin that version's id
 *   instead... [to] move to the new one on your own schedule" (same doc) is exactly the
 *   promise this guard enforces: pin `jev-1.13.0` and a `jev-1.14.0` answer is refused,
 *   not silently accepted. The response's `model` field always reports the versioned id
 *   that actually answered (same doc).
 *
 * ⛔ NEVER THROW FROM THE FETCH ADAPTER. The SDK wraps any exception its `fetch` hook
 *   throws as `APIConnectionError` (measured 2026-09-23,
 *   node_modules/@typesafe-ai/sdk@0.6.0/dist/index.mjs `attempt()`), and
 *   `isRetryableError` retries that by default (`DEFAULT_RETRY_POLICY.apiConnectionError
 *   === true`, same file) — so a thrown mismatch would be silently retried, and every
 *   retry is a second billed `/ai/run` call. Build a synthetic `Response` instead, the
 *   same way gateway-map.ts's own local refusals do; 422 sits outside the SDK's default
 *   retryable status set (408/429/5xx, same file) so it is not retried either.
 *
 * The SDK builds its own `APIError` subclasses from `APIError.fromResponse()` (same
 * file) — 422 becomes `UnprocessableEntityError`. There is no seam to add a dedicated
 * subclass without wrapping `TypeSafeClient` itself, which would break the "not a
 * replacement client" rule this package holds throughout (see ../src/index.ts).
 * `modelMismatchOf()` below is the typed escape hatch instead: it reads an *existing*
 * `APIError`'s `.status` and `.body` (both public fields, same file) and narrows them
 * back to the two model names, without needing a new error class.
 */

/** The only two names TypeSafe resolves to "the current release" rather than a pin. */
export const GATEWAY_MODEL_ALIASES: ReadonlySet<string> = new Set(['jev-latest', 'jev-preview']);

/** Response header carrying the model that actually answered, on every 200 and on a
 *  mismatch refusal alike — see gateway-map.ts's `mapResponse`. */
export const GATEWAY_MODEL_HEADER = 'x-homeflare-gateway-model';

/** Body `error.code` on the synthetic refusal this file builds — distinct from
 *  gateway-map.ts's other local refusals, which carry no `code`, so
 *  {@link modelMismatchOf} cannot mistake one for the other (see its test (e)). */
const MODEL_MISMATCH_CODE = 'model_version_mismatch';

/** The two model names a mismatch refusal was built from. */
export interface ModelMismatch {
  readonly requested: string;
  readonly answered: string;
}

/** True when `requestedModel` names a specific version rather than one of the two
 *  aliases above — see the file header on why every non-alias string counts. */
export function isExplicitModelVersion(requestedModel: string): boolean {
  return !GATEWAY_MODEL_ALIASES.has(requestedModel);
}

/**
 * Build the synthetic 422 refusal for an explicit-version request a different model
 * answered. Never thrown — see the file header. `extraHeaders` carries whatever else
 * the caller wants on the refusal (gateway-map.ts also sets the key-source header).
 */
export function modelMismatchRefusal(
  requestedModel: string,
  answeringModel: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const body = {
    error: {
      message: `requested model ${requestedModel}, gateway answered ${answeringModel}`,
      code: MODEL_MISMATCH_CODE,
    },
    requestedModel,
    answeringModel,
  };
  return new Response(JSON.stringify(body), {
    status: 422,
    headers: {
      'content-type': 'application/json',
      [GATEWAY_MODEL_HEADER]: answeringModel,
      ...extraHeaders,
    },
  });
}

/**
 * Narrow an SDK error down to the two model names, when — and only when — it is this
 * guard's own refusal. Returns `undefined` for every other `APIError` (wrong status,
 * no body, or a body without this guard's `code`), including gateway-map.ts's
 * unrelated "200 with an unexpected shape" 422. Duck-typed on `.status`/`.body` rather
 * than `instanceof APIError` so it works on any object shaped like the SDK's error —
 * the SDK is the only place that constructs one, but this guard does not need to import
 * a class to check a shape it does not otherwise depend on.
 */
export function modelMismatchOf(err: unknown): ModelMismatch | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { status?: unknown; body?: unknown };
  if (e.status !== 422) return undefined;
  if (typeof e.body !== 'object' || e.body === null) return undefined;
  const body = e.body as Record<string, unknown>;
  const errorField = body.error;
  if (typeof errorField !== 'object' || errorField === null) return undefined;
  if ((errorField as Record<string, unknown>).code !== MODEL_MISMATCH_CODE) return undefined;
  const requested = body.requestedModel;
  const answered = body.answeringModel;
  if (typeof requested !== 'string' || typeof answered !== 'string') return undefined;
  return { requested, answered };
}
