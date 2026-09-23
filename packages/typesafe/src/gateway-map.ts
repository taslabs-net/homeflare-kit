/**
 * Request/response mapping between the official TypeSafe SDK's `/v1/systemone` call
 * and Cloudflare's AI Gateway catalog route (`POST /client/v4/accounts/{id}/ai/run`).
 *
 * ★ MEASURED 2026-09-23, re-verified live for this change:
 *   - `developers.cloudflare.com/ai/models/typesafe/jev/schema-input.json` (fetched
 *     live) requires exactly `{state, questions}`, both required,
 *     `additionalProperties: false`. There is no `model` property — a version cannot
 *     be pinned through `input`.
 *   - `…/schema-output.json` requires `{model, answers, usage}`,
 *     `additionalProperties: false` — a 1:1 match for the SDK's `SystemOneResult`.
 *   - The estate's already-published, live-verified route doc
 *     (plugins/homeflare-workflows/skills/typesafe-ai/references/ai-gateway.md, dated
 *     2026-09-23, present on origin/main) records: HTTP 200,
 *     `result.result.model: "jev-1.13.0"`, answers/usage nested under `result.result`,
 *     `result.gatewayMetadata.keySource: "BYOK"`, and that the returned version does
 *     not change with what was asked for. Cited rather than re-measured here — see
 *     gateway.ts's file header for why a second live call was skipped.
 *
 * ⛔ PINNING IS THEREFORE UNAVAILABLE ON THIS ROUTE. `model` is read off the SDK's
 *   request only to be dropped: never forwarded into `input` (the schema would refuse
 *   it) and never used to refuse the call (every `systemOne()` request carries a
 *   `model`, defaulted to `jev-latest` by the SDK itself — refusing on its presence
 *   would refuse every call). The version that actually answered comes back from
 *   Cloudflare in the response body and is also carried on a response header.
 */

/** Non-secret placeholders. The real token lives only in the adapter's closure. */
export const GATEWAY_SENTINEL_BASE_URL = 'https://typesafe-gateway.invalid';
export const GATEWAY_SENTINEL_API_KEY = 'homeflare-gateway-transport-sentinel';
const SYSTEMONE_URL = `${GATEWAY_SENTINEL_BASE_URL}/v1/systemone`;

/** Header carrying `gatewayMetadata.keySource`, readable via `.withResponse()`. */
export const GATEWAY_KEY_SOURCE_HEADER = 'x-homeflare-gateway-key-source';

const ALLOWED_REQUEST_KEYS: ReadonlySet<string> = new Set(['state', 'questions', 'model']);

export interface GatewayRouteOptions {
  readonly accountId: string;
  readonly token: string;
  readonly gatewayId: string;
  readonly catalogModel: string;
}

export interface GatewayRequestMapped {
  readonly request: { readonly url: string; readonly init: RequestInit };
}
export interface GatewayRequestRefused {
  readonly refusal: Response;
}
export type MapRequestResult = GatewayRequestMapped | GatewayRequestRefused;

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

/** A refusal built entirely locally — the real network is never touched for these. */
function refuse(status: number, message: string): Response {
  return jsonResponse(status, { error: { message } });
}

/**
 * Build the outgoing Cloudflare request, or the synthetic `Response` to hand straight
 * back when the call cannot be mapped onto this route.
 */
export function mapRequest(
  input: string,
  init: RequestInit | undefined,
  route: GatewayRouteOptions,
): MapRequestResult {
  if (input !== SYSTEMONE_URL || (init?.method ?? 'GET') !== 'POST') {
    // Covers GET /v1/models and anything else the SDK might call. 404 maps to the
    // SDK's NotFoundError and sits outside its retry set (408/429/5xx).
    return { refusal: refuse(404, 'not available on the Cloudflare /ai/run route') };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(typeof init?.body === 'string' ? init.body : '') as Record<string, unknown>;
  } catch {
    return { refusal: refuse(400, 'request body was not JSON') };
  }

  for (const key of Object.keys(parsed)) {
    if (!ALLOWED_REQUEST_KEYS.has(key)) {
      return { refusal: refuse(400, `unsupported request property: ${key}`) };
    }
  }
  // `model` (always present — the SDK defaults it to `jev-latest`) is intentionally
  // left out of `input`: see the file header on why pinning cannot be forwarded.
  const body = {
    model: route.catalogModel,
    input: { state: parsed.state, questions: parsed.questions },
  };

  return {
    request: {
      url: `https://api.cloudflare.com/client/v4/accounts/${route.accountId}/ai/run`,
      init: {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${route.token}`,
          'cf-aig-gateway-id': route.gatewayId,
          'cf-aig-no-wholesale': 'true',
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      },
    },
  };
}

interface CloudflareEnvelope {
  readonly success?: unknown;
  readonly result?: {
    readonly result?: {
      readonly model?: unknown;
      readonly answers?: unknown;
      readonly usage?: unknown;
    };
    readonly gatewayMetadata?: { readonly keySource?: unknown };
  } | null;
  readonly errors?: ReadonlyArray<{ readonly code?: unknown; readonly message?: unknown }>;
}

function isSystemOneResult(
  value: unknown,
): value is { model: string; answers: object; usage: object } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.model === 'string' &&
    typeof v.answers === 'object' &&
    v.answers !== null &&
    typeof v.usage === 'object' &&
    v.usage !== null
  );
}

function pickRetryHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  const retryAfter = headers.get('retry-after');
  const retryAfterMs = headers.get('retry-after-ms');
  if (retryAfter !== null) out['retry-after'] = retryAfter;
  if (retryAfterMs !== null) out['retry-after-ms'] = retryAfterMs;
  return out;
}

/** Map Cloudflare's response envelope onto what the SDK's `parseBody` expects. */
export async function mapResponse(cfResponse: Response): Promise<Response> {
  const text = await cfResponse.text();
  let envelope: CloudflareEnvelope | undefined;
  try {
    envelope = JSON.parse(text) as CloudflareEnvelope;
  } catch {
    envelope = undefined;
  }

  if (cfResponse.ok) {
    const inner = envelope?.result?.result;
    if (isSystemOneResult(inner)) {
      const keySource = envelope?.result?.gatewayMetadata?.keySource;
      return jsonResponse(200, inner, {
        [GATEWAY_KEY_SOURCE_HEADER]: typeof keySource === 'string' ? keySource : '',
      });
    }
    // ⚠️ NOT 502 and NOT a throw: both land in the SDK's retry set (APIConnectionError,
    //   and 500-599, are retried) and would bill the gateway again for a shape our own
    //   parsing already knows is unusable. 422 sits outside that set and maps to the
    //   SDK's UnprocessableEntityError.
    return refuse(422, 'gateway returned 200 with an unexpected response shape');
  }

  const messages = envelope?.errors
    ?.map((e) => `${e.code ?? '?'} ${e.message ?? ''}`.trim())
    .filter((m) => m.length > 0)
    .join('; ');
  return jsonResponse(
    cfResponse.status,
    {
      error: { message: messages || `${cfResponse.status} gateway error` },
      cloudflare: envelope ?? text,
    },
    pickRetryHeaders(cfResponse.headers),
  );
}
